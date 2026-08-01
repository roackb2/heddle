import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { LlmAdapterService } from '@/core/llm/index.js';
import type { LlmAdapter, LlmAdapterCreateInput, LlmResponse } from '@/core/llm/types.js';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
  type HeartbeatTaskRunnerAgentOptions,
  type HeartbeatTaskRunnerRuntimeOptions,
} from '../../../advanced.js';

const NOW = new Date('2026-08-01T04:00:00.000Z');

describe('custom heartbeat runner credentials', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('runs custom host work through stored OpenAI OAuth without exposing credential fields', async () => {
    clearProviderEnvironment();
    const workspaceRoot = createWorkspace('oauth');
    const credentialStorePath = storeOAuthCredential({ workspaceRoot, provider: 'openai' });
    const createAdapter = mockModelAdapter();
    const capture = createLogCapture();

    const execution = await runCustomHeartbeat({
      workspaceRoot,
      model: 'gpt-5.4',
      agentOptions: { logger: capture.logger },
    });

    expect(execution.contextKeys).toEqual(['runAgent']);
    expect(execution.result).toMatchObject({ checked: 1, ran: 1, failed: 0 });
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.4',
      credentials: {
        apiKey: undefined,
        credential: expect.objectContaining({
          type: 'oauth',
          provider: 'openai',
          accessToken: 'stored-access-token',
        }),
        credentialStorePath,
      },
    }));

    const externallyVisibleState = JSON.stringify({
      tasks: execution.savedTasks,
      checkpoints: execution.savedCheckpoints,
      records: execution.savedRecords,
      events: execution.events,
      logs: capture.read(),
    });
    expect(externallyVisibleState).not.toContain('stored-access-token');
    expect(externallyVisibleState).not.toContain('stored-refresh-token');
    expect(externallyVisibleState).not.toContain('stored-account-id');
  });

  it('preserves explicit and provider API-key resolution for custom runners', async () => {
    clearProviderEnvironment();
    const explicitCreate = mockModelAdapter();
    const explicit = await runCustomHeartbeat({
      workspaceRoot: createWorkspace('explicit-key'),
      model: 'gpt-5.4',
      runtime: {
        apiKey: 'explicit-openai-key',
        apiKeyProvider: 'explicit',
      },
    });

    expect(explicit.result).toMatchObject({ ran: 1, failed: 0 });
    expect(explicitCreate).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({ apiKey: 'explicit-openai-key', credential: undefined }),
    }));
    expect(JSON.stringify(explicit.savedRecords)).not.toContain('explicit-openai-key');

    vi.restoreAllMocks();
    vi.stubEnv('ANTHROPIC_API_KEY', 'provider-anthropic-key');
    const providerCreate = mockModelAdapter();
    const provider = await runCustomHeartbeat({
      workspaceRoot: createWorkspace('provider-key'),
      model: 'claude-sonnet-4-6',
    });

    expect(provider.result).toMatchObject({ ran: 1, failed: 0 });
    expect(providerCreate).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({ apiKey: 'provider-anthropic-key', credential: undefined }),
    }));
    expect(JSON.stringify(provider.savedRecords)).not.toContain('provider-anthropic-key');
  });

  it('honors preferApiKey without exposing the stored OAuth principal', async () => {
    clearProviderEnvironment();
    vi.stubEnv('OPENAI_API_KEY', 'preferred-openai-key');
    const workspaceRoot = createWorkspace('preferred-key');
    storeOAuthCredential({ workspaceRoot, provider: 'openai' });
    const createAdapter = mockModelAdapter();

    const execution = await runCustomHeartbeat({
      workspaceRoot,
      model: 'gpt-5.4',
      runtime: { preferApiKey: true },
    });

    expect(execution.result).toMatchObject({ ran: 1, failed: 0 });
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({ apiKey: 'preferred-openai-key', credential: undefined }),
    }));
    const persisted = JSON.stringify({
      tasks: execution.savedTasks,
      checkpoints: execution.savedCheckpoints,
      records: execution.savedRecords,
      events: execution.events,
    });
    expect(persisted).not.toContain('preferred-openai-key');
    expect(persisted).not.toContain('stored-account-id');
  });

  it('keeps no-key local endpoints on the standard custom-runner path', async () => {
    clearProviderEnvironment();
    vi.stubEnv('OLLAMA_OPENAI_BASE_URL', 'http://127.0.0.1:11434/v1/');
    const createAdapter = mockModelAdapter();

    const execution = await runCustomHeartbeat({
      workspaceRoot: createWorkspace('local-endpoint'),
      model: 'ollama/qwen3:8b',
    });

    expect(execution.result).toMatchObject({ ran: 1, failed: 0 });
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({
      model: 'ollama/qwen3:8b',
      credentials: expect.objectContaining({ apiKey: undefined, credential: undefined }),
      runtime: expect.objectContaining({
        endpoint: {
          baseUrl: 'http://127.0.0.1:11434/v1',
          auth: { type: 'none' },
        },
      }),
    }));
  });

  it('fails missing and unsupported credentials before model execution with safe errors', async () => {
    clearProviderEnvironment();
    const missingCreate = mockModelAdapter();
    const missing = await runCustomHeartbeat({
      workspaceRoot: createWorkspace('missing'),
      model: 'claude-sonnet-4-6',
    });

    expect(missing.result).toMatchObject({ ran: 0, failed: 1 });
    expect(missingCreate).not.toHaveBeenCalled();
    expect(missing.events.at(-1)).toMatchObject({
      type: 'heartbeat.task.failed',
      error: expect.stringContaining('Missing Anthropic credential'),
    });

    vi.restoreAllMocks();
    clearProviderEnvironment();
    const workspaceRoot = createWorkspace('unsupported');
    storeOAuthCredential({ workspaceRoot, provider: 'anthropic' });
    const unsupportedCreate = mockModelAdapter();
    const unsupported = await runCustomHeartbeat({
      workspaceRoot,
      model: 'claude-sonnet-4-6',
    });

    expect(unsupported.result).toMatchObject({ ran: 0, failed: 1 });
    expect(unsupportedCreate).not.toHaveBeenCalled();
    expect(unsupported.events.at(-1)).toMatchObject({
      type: 'heartbeat.task.failed',
      error: expect.stringMatching(/Stored OAuth credentials are not supported for anthropic.*ANTHROPIC_API_KEY/),
    });
    const persisted = JSON.stringify({
      tasks: unsupported.savedTasks,
      checkpoints: unsupported.savedCheckpoints,
      records: unsupported.savedRecords,
      events: unsupported.events,
    });
    expect(persisted).not.toContain('stored-access-token');
    expect(persisted).not.toContain('stored-refresh-token');
    expect(persisted).not.toContain('stored-account-id');
  });
});

async function runCustomHeartbeat(input: {
  workspaceRoot: string;
  model: string;
  runtime?: Partial<HeartbeatTaskRunnerRuntimeOptions>;
  agentOptions?: HeartbeatTaskRunnerAgentOptions;
}) {
  const events: HeartbeatSchedulerEvent[] = [];
  const task: HeartbeatTask = {
    id: `custom-${input.model.replaceAll(/[^a-zA-Z0-9._-]/g, '-')}`,
    task: 'Process one host-owned work claim.',
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2026-08-01T03:59:00.000Z',
    },
  };
  const store = new FileHeartbeatTaskService({
    dir: join(input.workspaceRoot, '.heddle', 'heartbeat-credential-test'),
  });
  await store.saveTask(task);
  let contextKeys: string[] = [];

  const result = await HeartbeatSchedulerService.runDueTasks({
    store,
    now: () => NOW,
    runtime: {
      workspaceRoot: input.workspaceRoot,
      stateDir: '.heddle',
      model: input.model,
      tools: [],
      includeDefaultTools: false,
      ...input.runtime,
    },
    runner: async (scheduledTask, _checkpoint, context) => {
      contextKeys = Object.keys(context);
      return await context.runAgent({
        task: `${scheduledTask.task}\n\nUse the custom host context.`,
        maxSteps: 1,
        ...input.agentOptions,
      });
    },
    onEvent: (event) => events.push(structuredClone(event)),
  });
  const savedTasks = await store.listTasks();
  const savedCheckpoints = (await Promise.all(
    savedTasks.map(async (savedTask) => await store.loadCheckpoint(savedTask)),
  )).filter((checkpoint) => checkpoint !== undefined);
  const savedRecords = (await store.listRunRecords({ taskId: task.id })).map((entry) => entry.record);

  return {
    result,
    contextKeys,
    savedTasks,
    savedCheckpoints,
    savedRecords,
    events,
  };
}

function mockModelAdapter() {
  return vi.spyOn(LlmAdapterService, 'create').mockImplementation((input) => createModelAdapter(input));
}

function createModelAdapter(input: LlmAdapterCreateInput): LlmAdapter {
  const model = input.model ?? 'gpt-test';
  const provider = LlmAdapterService.inferProvider(model);
  return {
    info: {
      provider,
      model,
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: false,
        parallelToolCalls: provider === 'openai',
      },
    },
    async chat(): Promise<LlmResponse> {
      return {
        content: 'Processed the custom host work claim.\n\nHEARTBEAT_DECISION: complete',
      };
    },
  };
}

function createWorkspace(label: string): string {
  return mkdtempSync(join(tmpdir(), `heddle-heartbeat-credential-${label}-`));
}

function storeOAuthCredential(input: {
  workspaceRoot: string;
  provider: 'openai' | 'anthropic';
}): string {
  const storePath = ProviderCredentialRepository.resolveStorePath(join(input.workspaceRoot, '.heddle'));
  new ProviderCredentialRepository({ storePath }).set({
    type: 'oauth',
    provider: input.provider,
    accessToken: 'stored-access-token',
    refreshToken: 'stored-refresh-token',
    expiresAt: Date.now() + 60 * 60_000,
    accountId: 'stored-account-id',
    createdAt: '2026-08-01T03:00:00.000Z',
    updatedAt: '2026-08-01T03:00:00.000Z',
  });
  return storePath;
}

function clearProviderEnvironment(): void {
  for (const name of [
    'OPENAI_API_KEY',
    'PERSONAL_OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'PERSONAL_ANTHROPIC_API_KEY',
  ]) {
    vi.stubEnv(name, '');
  }
}

function createLogCapture() {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });

  return {
    logger: pino({ level: 'info' }, stream),
    read: () => output,
  };
}
