import { resolve } from 'node:path';
import type { ToolApprovalPolicyContext, ToolApprovalPolicyDecision } from '../types.js';
import { ToolPolicyEnvelopeInputService, type ToolPolicyEnvelope, type ToolPolicyOperation } from '@/core/tools/index.js';
import type {
  AutonomyEvaluation,
  AutonomyPolicyHint,
  AutopilotCapability,
  AutopilotDecision,
  AutopilotProfile,
  NormalizedAutopilotProfile,
  ToolPolicyFacts,
  ToolPolicyRootDecision,
} from './types.js';
import { AutopilotProfileService } from './profile-service.js';

const ENVELOPE_REQUIRED_TOOLS = new Set(['run_shell_mutate', 'edit_file', 'delete_file', 'move_file']);
const MUTATING_OPERATIONS = new Set<ToolPolicyOperation>(['write', 'delete', 'move', 'execute', 'git', 'network', 'unknown']);

/**
 * Owns autopilot allow/request/deny decisions from a profile plus tool facts.
 */
export class AutonomyPolicyService {
  static evaluate(args: {
    context: ToolApprovalPolicyContext;
    profile: AutopilotProfile;
  }): AutonomyEvaluation {
    const workspaceRoot = resolve(args.context.workspaceRoot ?? process.cwd());
    const profile = AutopilotProfileService.normalize({
      profile: args.profile,
      workspaceRoot,
    });
    const extraction = ToolPolicyEnvelopeInputService.extract(args.context.call.input);
    const envelope = extraction.envelope;
    const facts = AutonomyPolicyService.computeFacts({
      context: args.context,
      envelope,
      profile,
      workspaceRoot,
      extractionError: extraction.error,
      toolInput: extraction.toolInput,
    });
    const policyHints = AutonomyPolicyService.createPolicyHints(facts);
    const decision = AutonomyPolicyService.decide({
      context: args.context,
      envelope,
      facts,
      profile,
    });

    return {
      call: args.context.call,
      profileMode: profile.mode,
      envelope,
      facts,
      decision,
      policyHints,
    };
  }

  static toApprovalDecision(evaluation: AutonomyEvaluation): ToolApprovalPolicyDecision | undefined {
    if (evaluation.profileMode !== 'autopilot') {
      return undefined;
    }

    return {
      type: evaluation.decision.type,
      reason: evaluation.decision.reason,
      autonomyEvaluation: evaluation,
    };
  }

  private static decide(args: {
    context: ToolApprovalPolicyContext;
    envelope?: ToolPolicyEnvelope;
    facts: ToolPolicyFacts;
    profile: NormalizedAutopilotProfile;
  }): AutopilotDecision {
    const { context, envelope, facts, profile } = args;

    if (profile.mode !== 'autopilot') {
      return { type: 'request', reason: 'interactive approval mode', facts };
    }

    if (facts.hardDenyReasons.length > 0) {
      return { type: 'deny', reason: facts.hardDenyReasons.join('; '), facts };
    }

    if (AutonomyPolicyService.requiresPolicyEnvelope(context) && !envelope) {
      return { type: 'request', reason: 'tool call needs a declared policy envelope', facts };
    }

    if (!envelope) {
      return { type: 'allow', reason: 'autopilot profile does not require an envelope for this tool', facts };
    }

    if (envelope.confidence === 'low' || envelope.operations.includes('unknown')) {
      return { type: 'request', reason: 'policy envelope is not specific enough for autopilot', facts };
    }

    if (!profile.environments.allow.includes(envelope.environment as 'local' | 'dev')) {
      return { type: 'request', reason: 'environment is not allowed for unattended execution', facts };
    }

    if (facts.approvalReasons.length > 0) {
      return { type: 'request', reason: facts.approvalReasons.join('; '), facts };
    }

    return { type: 'allow', reason: 'allowed by autopilot profile and declared policy envelope', facts };
  }

  private static computeFacts(args: {
    context: ToolApprovalPolicyContext;
    envelope?: ToolPolicyEnvelope;
    profile: NormalizedAutopilotProfile;
    workspaceRoot: string;
    extractionError?: string;
    toolInput: unknown;
  }): ToolPolicyFacts {
    const command = AutonomyPolicyService.getShellCommand(args.context.call.tool, args.toolInput);
    const resolvedKnownTargets = AutonomyPolicyService.resolveKnownTargets({
      tool: args.context.call.tool,
      input: args.toolInput,
      workspaceRoot: args.workspaceRoot,
    });
    const operations = args.envelope?.operations ?? AutonomyPolicyService.inferOperations(args.context);
    const claimedReadRoots = AutonomyPolicyService.resolveEnvelopeRoots({
      roots: args.envelope?.readRoots ?? args.envelope?.targetRoots ?? [],
      workspaceRoot: args.workspaceRoot,
    });
    const claimedWriteRoots = AutonomyPolicyService.resolveEnvelopeRoots({
      roots: AutonomyPolicyService.resolveDeclaredWriteRoots(args.envelope),
      workspaceRoot: args.workspaceRoot,
    });
    const rootsToEvaluate = [...claimedReadRoots, ...claimedWriteRoots, ...resolvedKnownTargets];
    const rootDecisions = AutonomyPolicyService.resolveRootDecisions({
      roots: rootsToEvaluate,
      profile: args.profile,
    });
    const hardDenyReasons = [
      ...AutonomyPolicyService.resolveHardDenyReasons({ command, rootDecisions }),
      ...(args.extractionError ? [args.extractionError] : []),
    ];
    const approvalReasons = AutonomyPolicyService.resolveApprovalReasons({
      envelope: args.envelope,
      operations,
      rootDecisions,
      profile: args.profile,
      context: args.context,
    });

    return {
      tool: args.context.call.tool,
      operations,
      command,
      cwd: args.workspaceRoot,
      claimedReadRoots,
      claimedWriteRoots,
      resolvedKnownTargets,
      rootDecisions,
      hardDenyReasons,
      approvalReasons,
      claimMismatches: [],
    };
  }

  private static requiresPolicyEnvelope(context: ToolApprovalPolicyContext): boolean {
    return Boolean(context.tool.requiresApproval) || ENVELOPE_REQUIRED_TOOLS.has(context.call.tool);
  }

  private static inferOperations(context: ToolApprovalPolicyContext): ToolPolicyOperation[] {
    if (context.call.tool === 'read_file' || context.call.tool === 'list_files' || context.call.tool === 'search_files') {
      return ['read'];
    }

    if (context.call.tool === 'delete_file') {
      return ['delete'];
    }

    if (context.call.tool === 'move_file') {
      return ['move'];
    }

    if (context.call.tool === 'edit_file') {
      return ['write'];
    }

    if (context.call.tool === 'run_shell_mutate') {
      return ['execute'];
    }

    return context.tool.requiresApproval ? ['unknown'] : ['read'];
  }

  private static resolveDeclaredWriteRoots(envelope: ToolPolicyEnvelope | undefined): string[] {
    if (!envelope) {
      return [];
    }

    if (envelope.writeRoots) {
      return envelope.writeRoots;
    }

    return envelope.operations.some((operation) => MUTATING_OPERATIONS.has(operation))
      ? envelope.targetRoots
      : [];
  }

  private static resolveEnvelopeRoots(args: {
    roots: string[];
    workspaceRoot: string;
  }): string[] {
    return args.roots.map((root) => resolve(args.workspaceRoot, root));
  }

  private static resolveKnownTargets(args: {
    tool: string;
    input: unknown;
    workspaceRoot: string;
  }): string[] {
    const input = args.input;
    if (!isRecord(input)) {
      return [];
    }

    const pathValues = ['path', 'from', 'to']
      .map((key) => input[key])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    return pathValues.map((pathValue) => resolve(args.workspaceRoot, pathValue));
  }

  private static resolveRootDecisions(args: {
    roots: string[];
    profile: NormalizedAutopilotProfile;
  }): ToolPolicyRootDecision[] {
    const uniqueRoots = [...new Set(args.roots)];
    return uniqueRoots.map((root) => {
      const policy = AutopilotProfileService.findRootPolicy({
        profile: args.profile,
        target: root,
      });

      return policy
        ? { root, access: policy.access, matchedPolicyPath: policy.path }
        : { root, access: 'unconfigured' };
    });
  }

  private static resolveHardDenyReasons(args: {
    command?: string;
    rootDecisions: ToolPolicyRootDecision[];
  }): string[] {
    return [
      ...AutonomyPolicyService.resolveCommandHardDenyReasons(args.command),
      ...args.rootDecisions
        .filter((decision) => decision.access === 'deny')
        .map((decision) => `root is hard-denied by autopilot policy: ${decision.root}`),
    ];
  }

  private static resolveCommandHardDenyReasons(command: string | undefined): string[] {
    if (!command) {
      return [];
    }

    const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ');
    const patterns = [
      { pattern: /(?:^|[;&|])\s*rm\s+-rf\s+(?:\/|~|\$home)(?:\s|$)/, reason: 'root/home recursive deletion is blocked' },
      { pattern: /(?:^|[;&|])\s*rm\s+-rf\s+\.(?:\s|$)/, reason: 'workspace-wide recursive deletion is blocked' },
      { pattern: /(?:^|[;&|])\s*rm\s+-rf\s+\*(?:\s|$)/, reason: 'wildcard recursive deletion is blocked' },
      { pattern: /(?:^|[;&|])\s*sudo\b/, reason: 'sudo is blocked in autopilot' },
      { pattern: /(?:^|[;&|])\s*(?:su|doas)\b/, reason: 'privilege escalation is blocked in autopilot' },
      { pattern: /(?:^|[;&|])\s*git\s+reset\s+--hard\b/, reason: 'git history/worktree reset is blocked in autopilot' },
      { pattern: /(?:^|[;&|])\s*git\s+push\b.*\s--force(?:\s|$)/, reason: 'git force push is blocked in autopilot' },
      { pattern: /(?:^|[;&|])\s*mkfs(?:\.[^\s]+)?\b/, reason: 'disk formatting is blocked in autopilot' },
      { pattern: /(?:^|[;&|])\s*dd\b.*\bof=\/dev\//, reason: 'device writes are blocked in autopilot' },
      { pattern: /(?:^|[;&|])\s*terraform\s+destroy\b/, reason: 'terraform destroy is blocked in autopilot' },
    ];

    return patterns
      .filter(({ pattern }) => pattern.test(normalized))
      .map(({ reason }) => reason);
  }

  private static resolveApprovalReasons(args: {
    envelope?: ToolPolicyEnvelope;
    operations: ToolPolicyOperation[];
    rootDecisions: ToolPolicyRootDecision[];
    profile: NormalizedAutopilotProfile;
    context: ToolApprovalPolicyContext;
  }): string[] {
    if (!args.envelope) {
      return [];
    }
    const envelope = args.envelope;

    return [
      ...args.rootDecisions.flatMap((decision) => AutonomyPolicyService.rootApprovalReasons({
        decision,
        operations: args.operations,
        envelope,
        profile: args.profile,
      })),
      ...(args.operations.includes('network') ? ['network operations require approval in initial autopilot policy'] : []),
    ];
  }

  private static rootApprovalReasons(args: {
    decision: ToolPolicyRootDecision;
    operations: ToolPolicyOperation[];
    envelope: ToolPolicyEnvelope;
    profile: NormalizedAutopilotProfile;
  }): string[] {
    if (args.decision.access === 'unconfigured') {
      return [`root is not configured for autopilot: ${args.decision.root}`];
    }

    if (args.decision.access === 'manual-only') {
      return [`root requires manual approval: ${args.decision.root}`];
    }

    const policy = AutopilotProfileService.findRootPolicy({
      profile: args.profile,
      target: args.decision.root,
    });
    if (!policy) {
      return [`root is not configured for autopilot: ${args.decision.root}`];
    }

    return AutonomyPolicyService.requiredCapabilities(args.operations, args.envelope)
      .filter((capability) => !AutonomyPolicyService.rootAllowsCapability(policy.allow ?? [], policy.access, capability))
      .map((capability) => `root does not allow ${capability}: ${args.decision.root}`);
  }

  private static requiredCapabilities(
    operations: ToolPolicyOperation[],
    envelope: ToolPolicyEnvelope,
  ): AutopilotCapability[] {
    const capabilities = operations.flatMap((operation): AutopilotCapability[] => {
      if (operation === 'read') {
        return ['read'];
      }
      if (operation === 'write' || operation === 'move') {
        return envelope.maxDestructiveScope === 'many-files' ? ['write', 'many-file-edit'] : ['write'];
      }
      if (operation === 'delete') {
        return envelope.maxDestructiveScope === 'many-files' ? ['many-file-edit'] : ['simple-delete'];
      }
      if (operation === 'execute') {
        return ['execute'];
      }
      if (operation === 'git') {
        return ['git-stage'];
      }
      return [];
    });

    return [...new Set(capabilities)];
  }

  private static rootAllowsCapability(
    allow: AutopilotCapability[],
    access: ToolPolicyRootDecision['access'],
    capability: AutopilotCapability,
  ): boolean {
    if (access === 'read') {
      return capability === 'read';
    }

    if (access !== 'write' && access !== 'autopilot') {
      return false;
    }

    return allow.includes(capability);
  }

  private static createPolicyHints(facts: ToolPolicyFacts): AutonomyPolicyHint[] {
    return [
      ...facts.rootDecisions.flatMap((decision): AutonomyPolicyHint[] => {
        if (decision.access === 'unconfigured') {
          return [{
            kind: 'allow-root',
            message: `Add an autopilot root policy for ${decision.root} if this scope should run unattended.`,
            candidateConfig: {
              path: decision.root,
              access: 'autopilot',
              allow: ['read', 'write', 'execute'],
            },
          }];
        }

        if (decision.access === 'manual-only') {
          return [{
            kind: 'manual-only-root',
            message: `${decision.root} is manual-only. Move it to autopilot only if unattended work is expected there.`,
          }];
        }

        if (decision.access === 'deny') {
          return [{
            kind: 'deny-root',
            message: `${decision.root} is hard-denied and should stay blocked unless the root policy is intentionally changed.`,
          }];
        }

        return [];
      }),
      ...facts.hardDenyReasons.map((reason): AutonomyPolicyHint => ({
        kind: 'hard-deny-pattern',
        message: reason,
      })),
    ];
  }

  private static getShellCommand(tool: string, input: unknown): string | undefined {
    if (tool !== 'run_shell_mutate' || !isRecord(input)) {
      return undefined;
    }

    const command = input.command;
    return typeof command === 'string' && command.trim() ? command : undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
