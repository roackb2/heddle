import { join, resolve } from 'node:path';
import { appendMemoryCatalogSystemContext, DEFAULT_OPENAI_MODEL, inferProviderFromModel } from '../../../index.js';
import { saveTrace } from '../../../core/chat/trace.js';
import type { LlmProvider } from '../../../index.js';
import type { ResolvedRuntimeHost } from '../../../core/runtime/runtime-hosts.js';
import {
  hasProviderCredentialForModel as hasRuntimeProviderCredentialForModel,
  type ProviderCredentialSource,
  resolveOAuthCredentialForModel,
  resolveApiKeyForModel as resolveRuntimeApiKeyForModel,
  resolveProviderCredentialSourceForModel as resolveRuntimeProviderCredentialSourceForModel,
  resolveProviderApiKey as resolveRuntimeProviderApiKey,
} from '../../../core/runtime/api-keys.js';
import { parsePositiveInt } from './format.js';

export type ChatCliOptions = {
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  preferApiKey?: boolean;
  workspaceRoot?: string;
  stateDir?: string;
  directShellApproval?: 'always' | 'never';
  searchIgnoreDirs?: string[];
  systemContext?: string;
  runtimeHost?: ResolvedRuntimeHost;
  credentialStorePath?: string;
};

export type ChatRuntimeConfig = {
  model: string;
  maxSteps: number;
  apiKey?: string;
  apiKeyProvider?: LlmProvider | 'explicit';
  preferApiKey: boolean;
  providerCredentialPresent: boolean;
  providerCredentialSource: ProviderCredentialSource;
  stateRoot: string;
  logFile: string;
  sessionCatalogFile: string;
  approvalsFile: string;
  traceDir: string;
  memoryDir: string;
  workspaceRoot: string;
  credentialStorePath?: string;
  directShellApproval: 'always' | 'never';
  searchIgnoreDirs: string[];
  systemContext?: string;
  runtimeHost?: ResolvedRuntimeHost;
  saveTuiSnapshot?: (metadata?: { sessionId?: string; model?: string; status?: string; textSnapshot?: string }) => {
    capturedAt: string;
    txtPath: string;
    ansiPath: string;
    jsonPath: string;
  };
};

export { saveTrace };

export type { ProviderCredentialSource };

export function resolveChatRuntimeConfig(options: ChatCliOptions): ChatRuntimeConfig {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const sessionId = `chat-${Date.now()}`;
  const stateRoot = resolve(workspaceRoot, options.stateDir ?? '.heddle');
  const memoryDir = join(stateRoot, 'memory');
  const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const provider = inferProviderFromModel(model);
  const preferApiKey = Boolean(options.preferApiKey);
  const oauthCredential =
    options.apiKey || preferApiKey ? undefined
    : resolveOAuthCredentialForModel(model, { storePath: options.credentialStorePath });
  const apiKey = options.apiKey ?? (oauthCredential ? undefined : resolveProviderApiKey(provider));
  const apiKeyProvider = options.apiKey ? 'explicit' : apiKey ? provider : undefined;
  const providerCredentialSource = resolveProviderCredentialSourceForModel(model, {
    apiKey,
    apiKeyProvider,
    credentialStorePath: options.credentialStorePath,
    preferApiKey,
  });
  const providerCredentialPresent = providerCredentialSource.type !== 'missing';

  return {
    model,
    maxSteps: options.maxSteps ?? parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 100,
    apiKey,
    apiKeyProvider,
    preferApiKey,
    providerCredentialPresent,
    providerCredentialSource,
    workspaceRoot,
    credentialStorePath: options.credentialStorePath,
    stateRoot,
    logFile: join(stateRoot, 'logs', `${sessionId}.log`),
    sessionCatalogFile: join(stateRoot, 'chat-sessions.catalog.json'),
    approvalsFile: join(stateRoot, 'command-approvals.json'),
    traceDir: join(stateRoot, 'traces'),
    memoryDir,
    directShellApproval: options.directShellApproval ?? 'never',
    searchIgnoreDirs: options.searchIgnoreDirs ?? [],
    systemContext: appendMemoryCatalogSystemContext({
      systemContext: options.systemContext,
      memoryRoot: memoryDir,
    }),
    runtimeHost: options.runtimeHost,
  };
}

export function resolveProviderCredentialSourceForModel(
  model: string,
  runtime?: Pick<ChatRuntimeConfig, 'apiKey' | 'apiKeyProvider' | 'preferApiKey'> & { credentialStorePath?: string },
): ProviderCredentialSource {
  return resolveRuntimeProviderCredentialSourceForModel(model, runtime);
}

export function resolveProviderApiKey(provider: LlmProvider): string | undefined {
  return resolveRuntimeProviderApiKey(provider);
}

export function resolveApiKeyForModel(
  model: string,
  runtime?: Pick<ChatRuntimeConfig, 'apiKey' | 'apiKeyProvider' | 'credentialStorePath' | 'preferApiKey'>,
): string | undefined {
  return resolveRuntimeApiKeyForModel(model, runtime);
}

export function hasProviderCredentialForModel(
  model: string,
  runtime?: Pick<ChatRuntimeConfig, 'apiKey' | 'apiKeyProvider' | 'credentialStorePath' | 'preferApiKey'>,
): boolean {
  return hasRuntimeProviderCredentialForModel(model, runtime);
}
