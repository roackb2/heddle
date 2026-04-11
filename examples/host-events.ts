#!/usr/bin/env node
/**
 * Host Events Example
 *
 * Demonstrates how to consume Heddle's structured event stream for:
 * - Real-time progress monitoring
 * - Tool execution tracking
 * - Checkpoint persistence
 * - Escalation routing (for CyberLoop/Lucid integration)
 *
 * Usage:
 *   HEDDLE_EXAMPLE_MODEL=gpt-5.1-codex-mini npx tsx examples/host-events.ts
 */

import { runAgentLoop, runAgentHeartbeat, type AgentLoopEvent, type ToolDefinition } from '../src/index.js';
import type { ChatMessage, LlmAdapter, LlmResponse } from '../src/llm/types.js';

// ---------------------------------------------------------------------------
// Mock LLM for demo purposes (replace with real LLM in production)
// ---------------------------------------------------------------------------
const createMockLlm = (scenario: 'success' | 'tool-use' | 'escalate'): LlmAdapter => {
  let turn = 0;
  return {
    info: {
      provider: 'openai',
      model: 'gpt-demo',
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: false,
        parallelToolCalls: true,
      },
    },
    async chat(messages: ChatMessage[]): Promise<LlmResponse> {
      turn++;

      if (scenario === 'success') {
        return { content: `Demo response turn ${turn}` };
      }

      if (scenario === 'tool-use' && turn === 1) {
        return {
          content: 'Using echo tool.',
          toolCalls: [{ id: `call-${turn}`, tool: 'echo', input: { message: 'hello' } }],
        };
      }

      if (scenario === 'escalate') {
        return {
          content: 'Blocked by policy and need human input.\n\nHEARTBEAT_DECISION: escalate',
        };
      }

      return { content: `Turn ${turn} complete.` };
    },
  };
};

// ---------------------------------------------------------------------------
// Example tools
// ---------------------------------------------------------------------------
const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes input back',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  async execute(input: unknown) {
    return { ok: true, output: input };
  },
};

// ---------------------------------------------------------------------------
// Structured event logger - demonstrates host-facing event consumption
// ---------------------------------------------------------------------------
class StructuredEventLogger {
  private runId: string | null = null;
  private events: AgentLoopEvent[] = [];

  onEvent(event: AgentLoopEvent): void {
    this.events.push(event);

    // Capture runId from first event for correlation
    if (!this.runId && 'runId' in event) {
      this.runId = event.runId;
      console.log(`\n📋 Run started: ${this.runId}`);
      console.log('='.repeat(60));
    }

    switch (event.type) {
      case 'loop.started':
        console.log(`\n🚀 Loop started`);
        console.log(`   Goal: ${event.goal}`);
        console.log(`   Model: ${event.model} (${event.provider})`);
        if (event.resumedFromCheckpoint) {
          console.log(`   Resumed from: ${event.resumedFromCheckpoint}`);
        }
        break;

      case 'loop.resumed':
        console.log(`\n🔄 Resuming from checkpoint: ${event.fromCheckpoint}`);
        console.log(`   Prior trace events: ${event.priorTraceEvents}`);
        break;

      case 'assistant.stream':
        // Debounce stream events for cleaner output
        if (event.done) {
          console.log(`\n💬 Assistant [step ${event.step}]: "${event.text.slice(0, 60)}..."`);
        }
        break;

      case 'tool.calling':
        console.log(`\n🔧 Tool calling [step ${event.step}]: ${event.tool}`);
        console.log(`   ToolCall ID: ${event.toolCallId}`);
        console.log(`   Requires approval: ${event.requiresApproval}`);
        break;

      case 'tool.completed':
        console.log(`\n✅ Tool completed [step ${event.step}]: ${event.tool}`);
        console.log(`   Duration: ${event.durationMs}ms`);
        console.log(`   Result: ${event.result.ok ? 'success' : 'failed'}`);
        if (!event.result.ok && event.result.error) {
          console.log(`   Error: ${event.result.error}`);
        }
        break;

      case 'trace':
        // Trace events are verbose - log only important ones
        if (event.event.type === 'run.finished') {
          console.log(`\n🏁 Trace: run finished (${event.event.outcome})`);
        }
        break;

      case 'checkpoint.saved':
        console.log(`\n💾 Checkpoint saved [step ${event.step}]`);
        console.log(`   Checkpoint run: ${event.checkpoint.runId}`);
        console.log(`   Created at: ${event.checkpoint.createdAt}`);
        break;

      case 'heartbeat.decision':
        console.log(`\n💓 Heartbeat decision: ${event.decision}`);
        console.log(`   Outcome: ${event.outcome}`);
        console.log(`   Summary: ${event.summary.slice(0, 80)}...`);
        break;

      case 'escalation.required':
        console.log(`\n🚨 ESCALATION REQUIRED [step ${event.step}]`);
        console.log(`   Task: ${event.task}`);
        console.log(`   Outcome: ${event.outcome}`);
        console.log(`   Summary: ${event.summary.slice(0, 100)}...`);
        break;

      case 'loop.finished':
        console.log(`\n✨ Loop finished`);
        console.log(`   Outcome: ${event.outcome}`);
        console.log(`   Summary: ${event.summary.slice(0, 80)}...`);
        console.log(`   Total steps: ${event.state.trace.length}`);
        console.log(`   Usage: ${JSON.stringify(event.state.usage)}`);
        console.log('\n' + '='.repeat(60));
        break;
    }
  }

  getStats(): {
    totalEvents: number;
    toolCalls: number;
    checkpoints: number;
    escalations: number;
  } {
    return {
      totalEvents: this.events.length,
      toolCalls: this.events.filter((e) => e.type === 'tool.calling').length,
      checkpoints: this.events.filter((e) => e.type === 'checkpoint.saved').length,
      escalations: this.events.filter((e) => e.type === 'escalation.required').length,
    };
  }
}

// ---------------------------------------------------------------------------
// Example: Basic run with event logging
// ---------------------------------------------------------------------------
async function exampleBasicRun(): Promise<void> {
  console.log('\n' + '#'.repeat(60));
  console.log('# Example 1: Basic Run with Event Logging');
  console.log('#'.repeat(60));

  const logger = new StructuredEventLogger();

  await runAgentLoop({
    goal: 'Simple demo task',
    llm: createMockLlm('success'),
    tools: [],
    includeDefaultTools: false,
    maxSteps: 2,
    onEvent: (event) => logger.onEvent(event),
  });

  console.log('\n📊 Stats:', logger.getStats());
}

// ---------------------------------------------------------------------------
// Example: Tool execution tracking
// ---------------------------------------------------------------------------
async function exampleToolTracking(): Promise<void> {
  console.log('\n' + '#'.repeat(60));
  console.log('# Example 2: Tool Execution Tracking');
  console.log('#'.repeat(60));

  const logger = new StructuredEventLogger();

  await runAgentLoop({
    goal: 'Use echo tool',
    llm: createMockLlm('tool-use'),
    tools: [echoTool],
    includeDefaultTools: false,
    maxSteps: 2,
    onEvent: (event) => logger.onEvent(event),
  });

  console.log('\n📊 Stats:', logger.getStats());
}

// ---------------------------------------------------------------------------
// Example: Heartbeat with escalation
// ---------------------------------------------------------------------------
async function exampleHeartbeatEscalation(): Promise<void> {
  console.log('\n' + '#'.repeat(60));
  console.log('# Example 3: Heartbeat with Escalation Routing');
  console.log('#'.repeat(60));

  const logger = new StructuredEventLogger();

  const result = await runAgentHeartbeat({
    task: 'Background maintenance task',
    llm: createMockLlm('escalate'),
    tools: [],
    includeDefaultTools: false,
    maxSteps: 2,
    onEvent: (event) => logger.onEvent(event),
  });

  console.log('\n📊 Stats:', logger.getStats());
  console.log('\n📋 Heartbeat Result:');
  console.log(`   Decision: ${result.decision}`);
  console.log(`   Checkpoint ID: ${result.checkpoint.runId}`);

  // Demonstrate how Lucid/CyberLoop would route escalation
  if (result.decision === 'escalate') {
    console.log('\n🎯 Integration example:');
    console.log('   - Lucid would route to operator channel');
    console.log('   - CyberLoop would annotate drift in middleware');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('Heddle Host Events Example');
  console.log('Shows structured event consumption for external integration\n');

  await exampleBasicRun();
  await exampleToolTracking();
  await exampleHeartbeatEscalation();

  console.log('\n' + '#'.repeat(60));
  console.log('# All examples completed successfully');
  console.log('#'.repeat(60));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
