import cloneDeep from 'lodash/cloneDeep.js';
import pick from 'lodash/pick.js';
import { ToolApprovalProfileService } from '@/core/approvals/index.js';
import type { ToolApprovalPolicy } from '@/core/approvals/index.js';
import {
  CustomAgentRuntimeContextService,
} from '@/core/custom-agents/index.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';
import type { LlmAdapter } from '@/core/llm/types.js';
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
import { DelegationPolicyService } from './policy.js';
import type {
  DelegatedRunRecord,
  DelegationAgentProfileId,
  DelegationChildRuntimeOptions,
  DelegationPolicy,
} from './types.js';

const MANDATORY_CHILD_TOOL_PROFILE: RuntimeToolSelectionProfile = {
  preset: 'custom',
  allowedCapabilities: ['workspace.read', 'shell.inspect', 'artifact.read'],
  deniedCapabilities: [
    'agent.delegate',
    'workspace.write',
    'shell.mutate',
    'memory.read',
    'memory.write',
    'artifact.write',
    'external.read',
    'browser.read',
    'browser.action',
    'mcp.unknown',
    'internal.state',
  ],
  memoryMode: 'none',
};

const SAFE_CHILD_CAPABILITIES = new Set<ToolCapability>([
  'workspace.read',
  'shell.inspect',
  'artifact.read',
]);

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
] as const satisfies readonly (keyof DelegationChildRuntimeOptions)[];

/**
 * Builds and executes one child through the existing single-run runtime while
 * enforcing the non-widenable v1 context, tool, approval, and adapter rules.
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
  ): void {
    DelegationChildRuntimeService.assertReadOnlySnapshot(agentProfileId, snapshot);
    this.buildChildTools(snapshot);
  }

  async run(input: {
    record: DelegatedRunRecord;
    snapshot: CustomAgentExecutionSnapshot;
    signal: AbortSignal;
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
  }): Promise<AgentLoopResult> {
    input.signal.throwIfAborted();
    const tools = this.buildChildTools(input.snapshot);
    const systemContext = CustomAgentRuntimeContextService.appendAgentInstructions({
      systemContext: this.runtime.baseSystemContext,
      snapshot: input.snapshot,
    });
    const llm = await this.createChildLlm(input);
    input.signal.throwIfAborted();

    const {
      baseSystemContext: _baseSystemContext,
      createChildLlm: _createChildLlm,
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
      abortSignal: input.signal,
      ...(llm ? { llm } : {}),
    });
  }

  private buildChildTools(snapshot: CustomAgentExecutionSnapshot): ToolDefinition[] {
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
      profile: MANDATORY_CHILD_TOOL_PROFILE,
    });

    tools.forEach((tool) => {
      const capabilities = RuntimeToolProfileService.capabilitiesFor(tool);
      const isSafe = tool.name !== 'delegate_task'
        && capabilities.length > 0
        && capabilities.every((capability) => SAFE_CHILD_CAPABILITIES.has(capability));
      if (!isSafe) {
        throw new Error(
          `${DelegationPolicyService.message('agent_not_read_only')} Tool: ${tool.name}`,
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
    return ToolApprovalProfileService.compile({
      profile: { preset: 'read_only' },
      basePolicies: snapshotPolicies,
    });
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

  private static assertReadOnlySnapshot(
    agentProfileId: DelegationAgentProfileId,
    snapshot: CustomAgentExecutionSnapshot,
  ): void {
    const maxSteps = snapshot.runtime.maxSteps;
    const validStepDefault = maxSteps === undefined
      || (Number.isInteger(maxSteps) && maxSteps > 0);
    const safelyReadOnly = snapshot.agentProfileId === agentProfileId
      && snapshot.source === 'built-in'
      && snapshot.toolProfile.preset === 'inspect'
      && snapshot.toolProfile.memoryMode === 'none'
      && snapshot.approvalProfile.preset === 'read_only'
      && validStepDefault;
    if (!safelyReadOnly) {
      throw new Error(
        `${DelegationPolicyService.message('agent_not_read_only')} Profile: ${agentProfileId}`,
      );
    }
  }
}
