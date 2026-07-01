// ---------------------------------------------------------------------------
// Example: Browser Agent Smoke
//
// Usage:
//   yarn example:browser-agent-smoke
//   HEDDLE_BROWSER_AGENT_CREDENTIAL=api-key OPENAI_API_KEY=sk-... yarn example:browser-agent-smoke
//   yarn example:browser-agent-smoke:headed
//   yarn example:browser-agent-smoke:headless
//
// This example uses a real LLM with only the opt-in browser research toolkit.
// It validates whether the model can follow the browser tool sequence:
// browser_open -> browser_snapshot -> browser_click -> browser_screenshot ->
// browser_close.
// ---------------------------------------------------------------------------

import { join } from 'node:path';

import {
  AgentLoopRuntimeService,
  createBrowserResearchToolkit,
  RuntimeCredentialService,
  type AgentLoopEvent,
  type BrowserResearchToolkitOptions,
  type ProviderCredentialSource,
} from '../src/index.js';
import { LlmAdapterService } from '../src/core/llm/index.js';
import type { TraceEvent } from '../src/core/types.js';

const DEFAULT_EXAMPLE_MODEL = 'gpt-5.4';
const STATE_ROOT = join(process.cwd(), '.heddle', 'examples', 'browser-agent-smoke');
const START_URL = process.env.HEDDLE_BROWSER_START_URL ?? 'https://en.wikipedia.org/wiki/Browser_automation';
const ALLOWED_DOMAINS = ['wikipedia.org'];
const CREDENTIAL_MODES = ['auto', 'oauth', 'api-key'] as const;

type CredentialMode = (typeof CREDENTIAL_MODES)[number];

async function main() {
  const model = process.env.HEDDLE_EXAMPLE_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_EXAMPLE_MODEL;
  const provider = LlmAdapterService.inferProvider(model);
  const credentialMode = resolveCredentialMode(process.env.HEDDLE_BROWSER_AGENT_CREDENTIAL);
  const apiKey = credentialMode === 'api-key' ? RuntimeCredentialService.resolveProviderApiKey(provider) : undefined;
  if (credentialMode === 'api-key' && !apiKey) {
    throw new Error(`Missing API key for ${provider}. Set OPENAI_API_KEY for OpenAI models or ANTHROPIC_API_KEY for Claude models.`);
  }

  const credentialSource = RuntimeCredentialService.resolveCredentialSourceForModel(model, {
    apiKey,
    apiKeyProvider: apiKey ? 'explicit' : undefined,
    preferApiKey: credentialMode === 'api-key',
  });

  if (credentialSource.type === 'missing') {
    throw new Error(
      RuntimeCredentialService.formatMissingCredentialMessage(model) +
      ' Set HEDDLE_BROWSER_AGENT_CREDENTIAL=api-key to force platform API-key mode.',
    );
  }

  if (credentialMode === 'oauth' && credentialSource.type !== 'oauth') {
    throw new Error(`Missing OAuth credential for ${provider}. Run \`heddle auth login ${provider}\`, or use HEDDLE_BROWSER_AGENT_CREDENTIAL=auto.`);
  }

  const headless = resolveHeadlessMode(process.argv.slice(2));
  const browserToolkit = createBrowserResearchToolkit({
    stateRoot: STATE_ROOT,
    allowedDomains: ALLOWED_DOMAINS,
    profileId: 'agent-smoke',
    headless,
    channel: resolveChannel(process.env.HEDDLE_BROWSER_CHANNEL),
    maxElementsPerSnapshot: 80,
  });
  const tools = browserToolkit.createTools({
    workspaceRoot: process.cwd(),
    stateRoot: STATE_ROOT,
    artifactRoot: join(STATE_ROOT, 'artifacts'),
    model,
    apiKey,
    providerCredentialSource: credentialSource,
    memoryDir: join(STATE_ROOT, 'memory'),
    memoryMode: 'none',
  });

  console.log(
    [
      `[browser-agent-smoke] mode=${headless ? 'headless' : 'headed'}`,
      `model=${model}`,
      `credential=${formatCredentialSource(credentialSource)}`,
      `stateRoot=${STATE_ROOT}`,
    ].join(' '),
  );

  const runtimeOptions = apiKey ? { apiKey } : {};

  const result = await AgentLoopRuntimeService.run({
    goal: [
      'Use the browser tools to validate the browser research toolkit.',
      `Open ${START_URL}.`,
      'Capture a browser snapshot.',
      'Choose one safe same-domain Wikipedia link from the snapshot and click it.',
      'Capture a screenshot named agent-smoke-final-page.',
      'Close the browser.',
      'Then summarize the URL you opened, the link you clicked, and whether the screenshot was captured.',
      'Do not use any non-browser tools.',
    ].join('\n'),
    model,
    ...runtimeOptions,
    tools,
    includeDefaultTools: false,
    maxSteps: Number(process.env.HEDDLE_BROWSER_AGENT_MAX_STEPS ?? 8),
    onEvent(event) {
      const line = formatExampleEvent(event);
      if (line) {
        console.log(line);
      }
    },
  });

  console.log('\nFinal answer:\n');
  console.log(result.summary);

  const toolCalls = result.trace.flatMap((event) => (
    event.type === 'assistant.turn' ? event.toolCalls?.map((call) => call.tool) ?? [] : []
  ));
  console.log('\nTool calls:\n');
  console.log(toolCalls.join(' -> ') || '(none)');
}

function formatExampleEvent(event: AgentLoopEvent): string | undefined {
  switch (event.type) {
    case 'loop.started':
      return `[event] loop.started model=${event.model} provider=${event.provider}`;
    case 'assistant.stream':
      return event.done ? `[event] assistant.stream.done chars=${event.text.length} step=${event.step}` : undefined;
    case 'loop.finished':
      return `[event] loop.finished outcome=${event.outcome} input=${event.usage?.inputTokens ?? 0} output=${event.usage?.outputTokens ?? 0} total=${event.usage?.totalTokens ?? 0}`;
    case 'trace':
      return formatTraceEvent(event.event);
    default:
      return undefined;
  }
}

function formatTraceEvent(event: TraceEvent): string {
  switch (event.type) {
    case 'run.started':
      return `[trace] run.started goal=${JSON.stringify(shorten(event.goal))}`;
    case 'assistant.turn':
      return `[trace] assistant.turn step=${event.step} tools=${event.requestedTools ? event.toolCalls?.map((call) => call.tool).join(',') || 'yes' : 'none'} content=${JSON.stringify(shorten(event.content))}`;
    case 'tool.calling':
      return `[trace] tool.calling step=${event.step} tool=${event.call.tool} input=${JSON.stringify(event.call.input)}`;
    case 'tool.completed':
      return `[trace] tool.completed step=${event.step} tool=${event.call.tool} ok=${event.result.ok} output=${JSON.stringify(formatUnknown(event.result.output ?? event.result.error ?? ''))}`;
    case 'run.finished':
      return `[trace] run.finished step=${event.step} outcome=${event.outcome} summary=${JSON.stringify(shorten(event.summary))}`;
    default:
      return `[trace] ${event.type}`;
  }
}

function resolveHeadlessMode(args: string[]): boolean {
  if (args.includes('--headed')) {
    return false;
  }

  if (args.includes('--headless')) {
    return true;
  }

  return process.env.HEDDLE_BROWSER_HEADLESS !== 'false';
}

function resolveChannel(value: string | undefined): BrowserResearchToolkitOptions['channel'] {
  const channels: Array<BrowserResearchToolkitOptions['channel']> = ['chrome', 'chromium', 'msedge'];
  return channels.find((channel) => channel === value);
}

function resolveCredentialMode(value: string | undefined): CredentialMode {
  const mode = CREDENTIAL_MODES.find((candidate) => candidate === value);
  if (mode) {
    return mode;
  }

  return 'auto';
}

function formatCredentialSource(source: ProviderCredentialSource): string {
  if (source.type === 'oauth') {
    return source.accountId ? `oauth:${source.provider}:${source.accountId}` : `oauth:${source.provider}`;
  }

  if (source.type === 'env-api-key') {
    return `env-api-key:${source.provider}`;
  }

  if (source.type === 'explicit-api-key') {
    return 'explicit-api-key';
  }

  return `missing:${source.provider}`;
}

function shorten(value: string, maxLength = 120): string {
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
