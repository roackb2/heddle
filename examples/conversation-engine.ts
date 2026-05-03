// ---------------------------------------------------------------------------
// Example: Conversation Engine Alpha
//
// Usage:
//   OPENAI_API_KEY=sk-... yarn example:conversation-engine
//
// Optional:
//   HEDDLE_EXAMPLE_MODEL=claude-3-5-haiku-latest ANTHROPIC_API_KEY=sk-ant-... yarn example:conversation-engine
//
// This example uses the alpha persisted conversation engine API. It creates an
// engine, creates a session, submits a prompt, reports host callbacks, and
// prints the final outcome.
// ---------------------------------------------------------------------------

import {
  createConversationEngine,
  inferProviderFromModel,
  resolveProviderApiKey,
  type ConversationActivity,
  type ConversationCompactionStatus,
  type ToolApprovalPolicyContext,
  type TraceEvent,
} from '../src/index.js';

const DEFAULT_EXAMPLE_MODEL = 'gpt-5.1-codex-mini';

async function main() {
  const workspaceRoot = process.cwd();
  const stateRoot = `${workspaceRoot}/.heddle`;
  const model = process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_EXAMPLE_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = resolveProviderApiKey(provider);

  if (!apiKey) {
    throw new Error(
      [
        `Missing API key for ${provider}.`,
        provider === 'openai'
          ? 'Set OPENAI_API_KEY before running this example.'
          : provider === 'anthropic'
            ? 'Set ANTHROPIC_API_KEY before running this example.'
            : `Configure credentials for provider ${provider} before running this example.`,
        'This example uses a real provider and does not add a fake conversation-engine abstraction.',
      ].join(' '),
    );
  }

  const engine = createConversationEngine({
    workspaceRoot,
    stateRoot,
    model,
    apiKey,
    preferApiKey: true,
  });

  const session = engine.sessions.create({
    name: 'Programmatic conversation engine example',
  });

  console.log(`Starting session ${session.id} with model ${model} (${provider})`);
  console.log(`workspaceRoot=${workspaceRoot}`);
  console.log(`stateRoot=${stateRoot}`);

  const result = await engine.turns.submit({
    sessionId: session.id,
    prompt:
      'Summarize this repository, explain what Heddle is for, and list the main verification commands in a short bullet list.',
    host: {
      events: {
        onActivity(activity) {
          console.log(formatActivity(activity));
        },
      },
      approvals: {
        requestToolApproval: requestExampleToolApproval,
      },
      assistant: {
        onText(text) {
          process.stdout.write(text);
        },
      },
      trace: {
        onEvent(event) {
          console.log(`\n[trace] ${formatTraceEvent(event)}`);
        },
      },
      compaction: {
        onStatus(event) {
          console.log(`[compaction] ${formatCompactionStatus(event)}`);
        },
      },
    },
  });

  console.log('\n\nFinal result');
  console.log('------------');
  console.log(`Outcome: ${result.outcome}`);
  console.log(`Summary: ${result.summary}`);
  console.log(`Session ID: ${result.session.id}`);
  console.log(`Session name: ${result.session.name}`);
  console.log(`Turns stored: ${result.session.turns.length}`);
}

const requestExampleToolApproval = async (request: ToolApprovalPolicyContext) => {
  console.log(`\n[approval] tool=${request.call.tool} requires operator decision`);
  return {
    approved: false,
    reason: 'Example host denies approval-gated tools by default.',
  };
};

function formatActivity(activity: ConversationActivity): string {
  switch (activity.type) {
    case 'run.started':
      return `[activity] run.started run=${activity.runId ?? 'unknown'}`;
    case 'assistant.stream':
      return activity.done
        ? `[activity] assistant.stream done chars=${activity.text.length}`
        : `[activity] assistant.stream chunk chars=${activity.text.length}`;
    case 'tool.calling':
      return `[activity] tool.calling tool=${activity.tool} step=${activity.step ?? 'n/a'}`;
    case 'tool.approval_requested':
      return `[activity] tool.approval_requested tool=${activity.tool} step=${activity.step ?? 'n/a'}`;
    case 'memory.maintenance_started':
      return `[activity] memory.maintenance_started candidates=${activity.candidateCount}`;
    case 'run.finished':
      return `[activity] run.finished outcome=${activity.outcome}`;
    default:
      return `[activity] ${activity.type}`;
  }
}

function formatTraceEvent(event: TraceEvent): string {
  return event.type;
}

function formatCompactionStatus(event: ConversationCompactionStatus): string {
  switch (event.status) {
    case 'running':
      return event.archivePath ? `running archive=${event.archivePath}` : 'running';
    case 'finished':
      return event.summaryPath ? `finished summary=${event.summaryPath}` : 'finished';
    case 'failed':
      return event.error ? `failed error=${event.error}` : 'failed';
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
