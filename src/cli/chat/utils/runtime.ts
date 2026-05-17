import { join, resolve } from 'node:path';
import { appendMemoryCatalogSystemContext, DEFAULT_OPENAI_MODEL, LlmAdapterService } from '../../../index.js';
import type { LlmProvider } from '../../../index.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import {
  RuntimeCredentialService,
  type ProviderCredentialSource,
} from '@/core/runtime/credentials/index.js';
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
  // Desired shape: resolve the TUI-to-engine config boundary here once.
  // Future TUI turn paths should consume an engine-facing config object instead
  // of remapping sessionCatalogFile/providerCredentialPresent at each call site.
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

export type { ProviderCredentialSource };

export function resolveChatRuntimeConfig(options: ChatCliOptions): ChatRuntimeConfig {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const sessionId = `chat-${Date.now()}`;
  const stateRoot = resolve(workspaceRoot, options.stateDir ?? '.heddle');
  const memoryDir = join(stateRoot, 'memory');
  const credentialStorePath = options.credentialStorePath ?? ProviderCredentialRepository.resolveStorePath();
  const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const provider = LlmAdapterService.inferProvider(model);
  const preferApiKey = Boolean(options.preferApiKey);
  const oauthCredential =
    options.apiKey || preferApiKey ? undefined
    : RuntimeCredentialService.resolveOAuthCredentialForModel(model, { storePath: credentialStorePath });
  const apiKey = options.apiKey ?? (oauthCredential ? undefined : RuntimeCredentialService.resolveProviderApiKey(provider));
  const apiKeyProvider = options.apiKey ? 'explicit' : apiKey ? provider : undefined;
  const providerCredentialSource = RuntimeCredentialService.resolveCredentialSourceForModel(model, {
    apiKey,
    apiKeyProvider,
    credentialStorePath,
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
    credentialStorePath,
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
  return RuntimeCredentialService.resolveCredentialSourceForModel(model, runtime);
}

export function resolveProviderApiKey(provider: LlmProvider): string | undefined {
  return RuntimeCredentialService.resolveProviderApiKey(provider);
}

export function resolveApiKeyForModel(
  model: string,
  runtime?: Pick<ChatRuntimeConfig, 'apiKey' | 'apiKeyProvider' | 'credentialStorePath' | 'preferApiKey'>,
): string | undefined {
  return RuntimeCredentialService.resolveApiKeyForModel(model, runtime);
}

export function hasProviderCredentialForModel(
  model: string,
  runtime?: Pick<ChatRuntimeConfig, 'apiKey' | 'apiKeyProvider' | 'credentialStorePath' | 'preferApiKey'>,
): boolean {
  return RuntimeCredentialService.hasCredentialForModel(model, runtime);
}
