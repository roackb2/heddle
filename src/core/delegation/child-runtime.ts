import cloneDeep from 'lodash/cloneDeep.js';
import pick from 'lodash/pick.js';
import { ToolApprovalProfileService } from '@/core/approvals/index.js';
import type { ToolApprovalPolicy } from '@/core/approvals/index.js';
import {
  CustomAgentRuntimeContextService,
} from '@/core/custom-agents/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import { HeddleEventType } from '@/core/event-types.js';
import type { LlmAdapter } from '@/core/llm/types.js';
import type { ConversationAgentLoopActivity } from '@/core/live/index.js';
import {
  AgentLoopRuntimeService,
} from '@/core/runtime/loop/index.js';
import type { AgentLoopResult } from '@/core/runtime/loop/index.js';
import {
  RuntimeToolProfileService,
  RuntimeToolService,
} from '@/core/runtime/tools/index.js';
import type {
  RuntimeToolSelectionProfile,
  ToolCapability,
} from '@/core/runtime/tools/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type {
  DelegatedRunRecord,
  DelegationAgentProfileId,
  DelegationChildRuntimeOptions,
  DelegationPolicy,
} from './types.js';

const READ_ONLY_CHILD_TOOL_PROFILE: RuntimeToolSelectionProfile = {
  preset: 'custom',
  allowedCapabilities: ['workspace.read'],
  deniedCapabilities: [
    'agent.delegate',
    'workspace.write',
    'shell.inspect',
    'shell.mutate',
    'memory.read',
    'memory.write',
    'artifact.read',
    'artifact.write',
    'external.read',
    'browser.read',
    'browser.action',
    'mcp.unknown',
    'internal.state',
  ],
  memoryMode: 'none',
};

const ACTION_CHILD_TOOL_PROFILE: RuntimeToolSelectionProfile = {
  preset: 'custom',
  allowedCapabilities: [
    'workspace.read',
    'workspace.write',
    'shell.inspect',
    'shell.mutate',
  ],
  deniedCapabilities: [
    'agent.delegate',
    'memory.read',
    'memory.write',
    'artifact.read',
    'artifact.write',
    'external.read',
    'browser.read',
    'browser.action',
    'mcp.unknown',
    'internal.state',
  ],
  memoryMode: 'none',
};

const READ_ONLY_CHILD_CAPABILITIES = new Set<ToolCapability>([
  'workspace.read',
]);

const ACTION_CHILD_CAPABILITIES = new Set<ToolCapability>([
  'workspace.read',
  'workspace.write',
  'shell.inspect',
  'shell.mutate',
]);

const READ_ONLY_CHILD_TOOL_NAMES = new Set([
  'project_dashboard',
  'list_files',
  'read_file',
  'search_files',
]);

const ACTION_CHILD_TOOL_NAMES = new Set([
  ...READ_ONLY_CHILD_TOOL_NAMES,
  'edit_file',
  'delete_file',
  'move_file',
  'run_shell_inspect',
  'run_shell_mutate',
]);

const MUTATING_CHILD_CAPABILITIES = new Set<ToolCapability>([
  'workspace.write',
  'shell.mutate',
]);

const ACTION_CHILD_SYSTEM_CONTEXT = [
  'You are a bounded action-capable child agent working for a main agent.',
  'Complete only the delegated task in the shared workspace, use the granted tools when needed, and do not delegate further.',
  'Keep changes focused, verify them proportionately, and return a concise summary of actions, files, and validation.',
].join('\n');

const CHILD_RUNTIME_OPTION_KEYS = [
  'model',
  'reasoningEffort',
  'apiKey',
  'apiKeyProvider',
  'credential',
  'preferApiKey',
  'maxToolConcurrency',
  'stateDir',
  'memoryDir',
  'searchIgnoreDirs',
  'baseSystemContext',
  'logger',
  'createChildLlm',
  'parentTools',
  'approvalPolicies',
  'approveToolCall',
] as const satisfies readonly (keyof DelegationChildRuntimeOptions)[];

/**
 * Builds and executes one child through the existing single-run runtime while
 * enforcing the non-widenable context, tool, approval, and adapter rules.
 */
export class DelegationChildRuntimeService {
  private readonly runtime: Readonly<DelegationChildRuntimeOptions>;
  private readonly childAdapters = new WeakSet<object>();
  private readonly policy: DelegationPolicy;
  private readonly rootRunId: string;
  private readonly workspaceRoot: string;

  constructor(options: {
    rootRunId: string;
    workspaceRoot: string;
    policy: DelegationPolicy;
    runtime: DelegationChildRuntimeOptions;
  }) {
    this.rootRunId = options.rootRunId;
    this.workspaceRoot = options.workspaceRoot;
    this.policy = options.policy;
    const runtime = pick(options.runtime, CHILD_RUNTIME_OPTION_KEYS);
    this.runtime = Object.freeze({
      ...runtime,
      searchIgnoreDirs: runtime.searchIgnoreDirs
        ? Object.freeze([...runtime.searchIgnoreDirs]) as string[]
        : undefined,
      parentTools: runtime.parentTools
        ? Object.freeze([...runtime.parentTools]) as ToolDefinition[]
        : undefined,
      approvalPolicies: runtime.approvalPolicies
        ? Object.freeze([...runtime.approvalPolicies]) as ToolApprovalPolicy[]
        : undefined,
    });
    if (!this.runtime.model.trim() || this.runtime.model !== this.runtime.model.trim()) {
      throw new Error('Delegation child runtime model must be a non-empty trimmed string');
    }
  }

  /**
   * Fails before root execution if a configured profile or the current tool
   * catalog cannot satisfy the mandatory child envelope.
   */
  preflightSnapshot(
    agentProfileId: DelegationAgentProfileId,
    snapshot: CustomAgentExecutionSnapshot,
  ): boolean {
    DelegationChildRuntimeService.assertSupportedSnapshot(agentProfileId, snapshot);
    const tools = this.buildChildTools(snapshot);
    return !DelegationChildRuntimeService.isActionProfile(agentProfileId)
      || tools.some((tool) => DelegationChildRuntimeService.isMutatingTool(tool));
  }

  async run(input: {
    record: DelegatedRunRecord;
    snapshot: CustomAgentExecutionSnapshot;
    signal: AbortSignal;
    onActivity?: (activity: ConversationAgentLoopActivity) => void;
  }): Promise<AgentLoopResult> {
    try {
      return await this.execute(input);
    } catch (error: unknown) {
      if (!input.signal.aborted) {
        this.runtime.logger?.warn({
          rootRunId: this.rootRunId,
          delegationId: input.record.delegationId,
          childRunId: input.record.childRunId,
          errorType: error instanceof Error ? error.name : typeof error,
        }, 'Delegated child execution failed');
      }
      throw error;
    }
  }

  private async execute(input: {
    record: DelegatedRunRecord;
    snapshot: CustomAgentExecutionSnapshot;
    signal: AbortSignal;
    onActivity?: (activity: ConversationAgentLoopActivity) => void;
  }): Promise<AgentLoopResult> {
    input.signal.throwIfAborted();
    const tools = this.buildChildTools(input.snapshot);
    const profileSystemContext = CustomAgentRuntimeContextService.appendAgentInstructions({
      systemContext: this.runtime.baseSystemContext,
      snapshot: input.snapshot,
    });
    const systemContext = DelegationChildRuntimeService.isActionProfile(
      input.snapshot.agentProfileId as DelegationAgentProfileId,
    )
      ? [profileSystemContext, ACTION_CHILD_SYSTEM_CONTEXT].filter(Boolean).join('\n\n')
      : profileSystemContext;
    const llm = await this.createChildLlm(input);
    input.signal.throwIfAborted();

    const {
      baseSystemContext: _baseSystemContext,
      createChildLlm: _createChildLlm,
      parentTools: _parentTools,
      approvalPolicies: _approvalPolicies,
      approveToolCall,
      ...runtime
    } = this.runtime;
    const effectiveMaxSteps = Math.min(
      input.snapshot.runtime.maxSteps ?? this.policy.maxStepsPerChild,
      this.policy.maxStepsPerChild,
    );

    return await AgentLoopRuntimeService.run({
      ...runtime,
      runId: input.record.childRunId,
      goal: input.record.task,
      workspaceRoot: this.workspaceRoot,
      tools,
      includeDefaultTools: false,
      includePlanTool: false,
      history: [],
      systemContext,
      maxSteps: effectiveMaxSteps,
      approvalPolicies: this.createChildApprovalPolicies(input.snapshot),
      approveToolCall,
      abortSignal: input.signal,
      onEvent: (event) => {
        if (
          AgentLoopRuntimeService.isConversationActivity(event)
          && event.type !== HeddleEventType.assistantStream
        ) {
          input.onActivity?.(event);
        }
      },
      ...(llm ? { llm } : {}),
    });
  }

  private buildChildTools(snapshot: CustomAgentExecutionSnapshot): ToolDefinition[] {
    const agentProfileId = snapshot.agentProfileId as DelegationAgentProfileId;
    const actionCapable = DelegationChildRuntimeService.isActionProfile(agentProfileId);
    const toolProfile = actionCapable
      ? ACTION_CHILD_TOOL_PROFILE
      : READ_ONLY_CHILD_TOOL_PROFILE;
    const allowedToolNames = actionCapable
      ? ACTION_CHILD_TOOL_NAMES
      : READ_ONLY_CHILD_TOOL_NAMES;
    const parentToolNames = new Set(this.runtime.parentTools?.map((tool) => tool.name) ?? []);
    const snapshotTools = RuntimeToolService.createDefaultAgentTools({
      model: this.runtime.model,
      workspaceRoot: this.workspaceRoot,
      stateDir: this.runtime.stateDir,
      memoryDir: this.runtime.memoryDir,
      memoryMode: snapshot.toolProfile.memoryMode ?? 'none',
      searchIgnoreDirs: this.runtime.searchIgnoreDirs,
      includePlanTool: false,
      toolProfile: snapshot.toolProfile,
    });
    const tools = RuntimeToolProfileService.apply({
      tools: snapshotTools,
      profile: toolProfile,
    }).filter((tool) => (
      allowedToolNames.has(tool.name)
      && (!actionCapable || parentToolNames.has(tool.name))
    ));

    tools.forEach((tool) => {
      if (!DelegationChildRuntimeService.isAllowedChildTool(agentProfileId, tool)) {
        throw new Error(
          `Delegated child tool is outside the ${actionCapable ? 'action' : 'read-only'} allowlist: ${tool.name}`,
        );
      }
    });
    return tools;
  }

  private createChildApprovalPolicies(
    snapshot: CustomAgentExecutionSnapshot,
  ): ToolApprovalPolicy[] {
    const snapshotPolicies = ToolApprovalProfileService.compile({
      profile: snapshot.approvalProfile,
    });
    return [
      DelegationChildRuntimeService.enforceChildToolAllowlist(
        snapshot.agentProfileId as DelegationAgentProfileId,
      ),
      ...snapshotPolicies,
      ...(this.runtime.approvalPolicies ?? []),
    ];
  }

  private static enforceChildToolAllowlist(
    agentProfileId: DelegationAgentProfileId,
  ): ToolApprovalPolicy {
    return ({ tool }) => {
      return DelegationChildRuntimeService.isAllowedChildTool(agentProfileId, tool)
        ? undefined
        : {
          type: 'deny',
          reason: `${tool.name} is outside the delegated ${DelegationChildRuntimeService.isActionProfile(agentProfileId) ? 'action' : 'read-only'} tool allowlist`,
        };
    };
  }

  private static isAllowedChildTool(
    agentProfileId: DelegationAgentProfileId,
    tool: ToolDefinition,
  ): boolean {
    const actionCapable = DelegationChildRuntimeService.isActionProfile(agentProfileId);
    const allowedToolNames = actionCapable
      ? ACTION_CHILD_TOOL_NAMES
      : READ_ONLY_CHILD_TOOL_NAMES;
    const allowedCapabilities = actionCapable
      ? ACTION_CHILD_CAPABILITIES
      : READ_ONLY_CHILD_CAPABILITIES;
    const capabilities = RuntimeToolProfileService.capabilitiesFor(tool);
    return allowedToolNames.has(tool.name)
      && capabilities.length > 0
      && capabilities.every((capability) => allowedCapabilities.has(capability));
  }

  private async createChildLlm(input: {
    record: DelegatedRunRecord;
    snapshot: CustomAgentExecutionSnapshot;
    signal: AbortSignal;
  }): Promise<LlmAdapter | undefined> {
    if (!this.runtime.createChildLlm) {
      return undefined;
    }

    const adapter = await this.runtime.createChildLlm({
      rootRunId: this.rootRunId,
      parentRunId: this.rootRunId,
      childRunId: input.record.childRunId,
      delegationId: input.record.delegationId,
      depth: 1,
      task: input.record.task,
      agentSnapshot: cloneDeep(input.snapshot),
      model: this.runtime.model,
      reasoningEffort: this.runtime.reasoningEffort,
      signal: input.signal,
    });
    if (!adapter || typeof adapter !== 'object' || typeof adapter.chat !== 'function') {
      throw new TypeError('Delegation child LLM factory must return an LlmAdapter');
    }
    if (this.childAdapters.has(adapter)) {
      throw new Error('Delegation child LLM factory must return a fresh adapter for every child');
    }

    this.childAdapters.add(adapter);
    return adapter;
  }

  private static assertSupportedSnapshot(
    agentProfileId: DelegationAgentProfileId,
    snapshot: CustomAgentExecutionSnapshot,
  ): void {
    const maxSteps = snapshot.runtime.maxSteps;
    const validStepDefault = maxSteps === undefined
      || (Number.isInteger(maxSteps) && maxSteps > 0);
    const sharedInvariant = snapshot.agentProfileId === agentProfileId
      && snapshot.source === 'built-in'
      && validStepDefault;
    const validProfile = DelegationChildRuntimeService.isActionProfile(agentProfileId)
      ? snapshot.toolProfile.preset === 'default'
        && snapshot.approvalProfile.preset === 'interactive'
      : snapshot.toolProfile.preset === 'inspect'
        && snapshot.toolProfile.memoryMode === 'none'
        && snapshot.approvalProfile.preset === 'read_only';
    if (!sharedInvariant || !validProfile) {
      throw new Error(
        `The requested child agent profile does not satisfy its delegated authority envelope. Profile: ${agentProfileId}`,
      );
    }
  }

  static isActionProfile(agentProfileId: DelegationAgentProfileId): boolean {
    return agentProfileId === 'builtin:code';
  }

  private static isMutatingTool(tool: ToolDefinition): boolean {
    return RuntimeToolProfileService.capabilitiesFor(tool)
      .some((capability) => MUTATING_CHILD_CAPABILITIES.has(capability));
  }
}
