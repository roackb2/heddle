/**
 * Heartbeat runner agent.
 *
 * Runs one autonomous heartbeat task through the generic runtime loop. It owns
 * heartbeat-specific prompt context and lifecycle events, but delegates
 * model/tool stepping to `AgentLoopRuntimeService`.
 */
import { resolve } from 'node:path';
import dayjs from 'dayjs';
import { MemoryCatalogService } from '@/core/memory/catalog.js';
import { AgentLoopCheckpointService, AgentLoopRuntimeService } from '@/core/runtime/loop/index.js';
import type { RunAgentLoopOptions } from '@/core/runtime/loop/index.js';
import { HeartbeatDecisionPolicy } from './decision.js';
import { HeartbeatRunnerAgentPrompt } from './prompt.js';
import type { AgentHeartbeatResult, RunAgentHeartbeatOptions } from './types.js';

const DEFAULT_HEARTBEAT_MAX_STEPS = 80;

export class HeartbeatRunnerAgent {
  static async run(options: RunAgentHeartbeatOptions): Promise<AgentHeartbeatResult> {
    const runtime = HeartbeatRunnerAgent.toRuntimeOptions(options);
    const result = await AgentLoopRuntimeService.run(runtime);
    const decision = HeartbeatDecisionPolicy.infer(result.summary, result.outcome);
    const runId = result.state.runId;
    const checkpoint = AgentLoopCheckpointService.createCheckpoint(result.state);
    const now = () => dayjs().toISOString();

    options.onEvent?.({
      type: 'heartbeat.decision',
      runId,
      decision,
      outcome: result.outcome,
      summary: result.summary,
      timestamp: now(),
    });

    if (decision === 'escalate') {
      options.onEvent?.({
        type: 'escalation.required',
        runId,
        task: options.task,
        outcome: result.outcome,
        summary: result.summary,
        step: result.trace.length,
        timestamp: now(),
      });
    }

    options.onEvent?.({
      type: 'checkpoint.saved',
      runId,
      checkpoint,
      step: result.trace.length,
      timestamp: now(),
    });

    return {
      decision,
      summary: result.summary,
      checkpoint,
      state: result.state,
    };
  }

  private static toRuntimeOptions(options: RunAgentHeartbeatOptions): RunAgentLoopOptions {
    const {
      task,
      checkpoint,
      runContext,
      maxSteps,
      memoryDir: providedMemoryDir,
      stateDir,
      workspaceRoot,
      systemContext: providedSystemContext,
      onEvent,
      ...runtimeOptions
    } = options;
    const memoryDir = providedMemoryDir ?? resolve(workspaceRoot ?? process.cwd(), stateDir ?? '.heddle', 'memory');
    const systemContext = HeartbeatRunnerAgentPrompt.appendSystemContext(new MemoryCatalogService(memoryDir).appendCatalogSystemContext({
      systemContext: providedSystemContext,
    }));

    return {
      ...runtimeOptions,
      goal: HeartbeatRunnerAgentPrompt.buildGoal(task, runContext),
      maxSteps: maxSteps ?? DEFAULT_HEARTBEAT_MAX_STEPS,
      workspaceRoot,
      stateDir,
      memoryDir,
      systemContext,
      resumeFrom: checkpoint,
      onEvent,
    };
  }
}
