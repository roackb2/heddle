// ---------------------------------------------------------------------------
// Example: Programmatic Loop
//
// Usage:
//   OPENAI_API_KEY=sk-... yarn example:programmatic
//
// Optional:
//   HEDDLE_EXAMPLE_MODEL=claude-3-5-haiku-latest ANTHROPIC_API_KEY=sk-ant-... yarn example:programmatic
//
// This example uses a real LLM plus one custom host tool. It demonstrates how
// another app can embed Heddle as an evented execution loop without going
// through the terminal chat UI.
//
// For a no-key test of this API, see src/__tests__/agent-loop.test.ts.
// ---------------------------------------------------------------------------

import { runAgentLoop, type AgentLoopEvent } from '../src/runtime/agent-loop.js';
import { createAgentLoopCheckpoint } from '../src/runtime/events.js';
import type { ToolDefinition } from '../src/types.js';
import type { TraceEvent } from '../src/types.js';
import { resolveProviderApiKey } from '../src/runtime/api-keys.js';
import { inferProviderFromModel } from '../src/llm/providers.js';

const DEFAULT_EXAMPLE_MODEL = 'gpt-5.1-codex-mini';

const echoTool: ToolDefinition = {
  name: 'echo_context',
  description: 'Echoes a small piece of host-provided context.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
    },
    required: ['topic'],
    additionalProperties: false,
  },
  async execute(input) {
    return {
      ok: true,
      output: {
        input,
        note: 'This result came from a custom host tool.',
      },
    };
  },
};

async function main() {
  const model = process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_EXAMPLE_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = resolveProviderApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider}. ` +
      'Set OPENAI_API_KEY for OpenAI models or ANTHROPIC_API_KEY for Claude models before running this example.',
    );
  }

  const result = await runAgentLoop({
    goal:
      'Use the echo_context tool once, then explain in two short sentences how another app can embed Heddle as a programmatic agent loop.',
    model,
    apiKey,
    tools: [echoTool],
    includeDefaultTools: false,
    maxSteps: 3,
    onEvent(event) {
      const line = formatExampleEvent(event);
      if (line) {
        console.log(line);
      }
    },
  });

  console.log('\nFinal answer:\n');
  console.log(result.summary);

  const checkpoint = createAgentLoopCheckpoint(result.state);
  console.log('\nCheckpoint preview:\n');
  console.log(JSON.stringify({
    version: checkpoint.version,
    model: checkpoint.state.model,
    outcome: checkpoint.state.outcome,
    transcriptMessages: checkpoint.state.transcript.length,
    traceEvents: checkpoint.state.trace.length,
  }, null, 2));
  process.exit(0);
}

function formatExampleEvent(event: AgentLoopEvent): string | undefined {
  switch (event.type) {
    case 'loop.started':
      return `[event] loop.started model=${event.model} provider=${event.provider} workspace=${event.workspaceRoot}`;
    case 'assistant.stream':
      return event.done ? `[event] assistant.stream.done chars=${event.text.length} step=${event.step}` : undefined;
    case 'loop.finished':
      return `[event] loop.finished outcome=${event.outcome} transcript=${event.state.transcript.length} trace=${event.state.trace.length} input=${event.usage?.inputTokens ?? 0} output=${event.usage?.outputTokens ?? 0} total=${event.usage?.totalTokens ?? 0}`;
    case 'trace':
      return formatTraceEvent(event.event);
  }
}

function formatTraceEvent(event: TraceEvent): string {
  switch (event.type) {
    case 'run.started':
      return `[trace] run.started goal=${JSON.stringify(shorten(event.goal))}`;
    case 'assistant.turn':
      return `[trace] assistant.turn step=${event.step} tools=${event.requestedTools ? event.toolCalls?.map((call) => call.tool).join(',') || 'yes' : 'none'} content=${JSON.stringify(shorten(event.content))}`;
    case 'tool.approval_requested':
      return `[trace] tool.approval_requested step=${event.step} tool=${event.call.tool}`;
    case 'tool.approval_resolved':
      return `[trace] tool.approval_resolved step=${event.step} tool=${event.call.tool} approved=${event.approved}`;
    case 'tool.fallback':
      return `[trace] tool.fallback step=${event.step} from=${event.fromCall.tool} to=${event.toCall.tool} reason=${JSON.stringify(shorten(event.reason))}`;
    case 'tool.call':
      return `[trace] tool.call step=${event.step} tool=${event.call.tool} input=${JSON.stringify(event.call.input)}`;
    case 'tool.result':
      return `[trace] tool.result step=${event.step} tool=${event.tool} ok=${event.result.ok} output=${JSON.stringify(formatUnknown(event.result.output ?? event.result.error ?? ''))}`;
    case 'cyberloop.annotation':
      return `[trace] cyberloop.annotation step=${event.step} frame=${event.frameKind} drift=${event.driftLevel}`;
    case 'run.finished':
      return `[trace] run.finished step=${event.step} outcome=${event.outcome} summary=${JSON.stringify(shorten(event.summary))}`;
  }
}

function shorten(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return shorten(value);
  }

  return shorten(JSON.stringify(value));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
