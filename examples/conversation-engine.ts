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
  createConversationTextHost,
  defineHostExtension,
  LlmAdapterService,
  RuntimeCredentialService,
  type ToolDefinition,
  type ToolApprovalPolicyContext,
} from '../src/advanced.js';

const DEFAULT_EXAMPLE_MODEL = 'gpt-5.1-codex-mini';

async function main() {
  const workspaceRoot = process.cwd();
  const stateRoot = `${workspaceRoot}/.heddle`;
  const model = process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_EXAMPLE_MODEL;
  const provider = LlmAdapterService.inferProvider(model);
  const apiKey = RuntimeCredentialService.resolveProviderApiKey(provider);

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
    hostExtensions: [createExampleHostExtension()],
  });

  const session = engine.sessions.create({
    name: 'Programmatic conversation engine example',
  });

  console.log(`Starting session ${session.id} with model ${model} (${provider})`);
  console.log(`workspaceRoot=${workspaceRoot}`);
  console.log(`stateRoot=${stateRoot}`);
  const textHost = createConversationTextHost({ trace: 'status' });

  const result = await engine.turns.submit({
    sessionId: session.id,
    prompt:
      'Summarize this repository, explain what Heddle is for, and list the main verification commands in a short bullet list.',
    host: {
      ...textHost.host,
      approvals: {
        requestToolApproval: requestExampleToolApproval,
      },
    },
  });

  textHost.renderTurnResult(result);
}

function createExampleHostExtension() {
  const createProjectBriefTool: ToolDefinition = {
    name: 'create_project_brief',
    description: 'Create a compact project brief artifact from a title and summary.',
    capabilities: ['workspace.write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['title', 'summary'],
    },
    execute: async (input) => ({
      ok: true,
      output: input,
    }),
  };

  return defineHostExtension({
    id: 'project-brief-workspace',
    tools: [createProjectBriefTool],
    systemContext: 'Use create_project_brief when the user asks for a structured project brief, then save durable outputs as artifacts.',
    artifacts: {
      enabled: true,
    },
  });
}

const requestExampleToolApproval = async (request: ToolApprovalPolicyContext) => {
  console.log(`\n[approval] tool=${request.call.tool} requires operator decision`);
  return {
    approved: false,
    reason: 'Example host denies approval-gated tools by default.',
  };
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
