import { describe, expect, it, vi } from 'vitest';
import { createSlashCommandRegistry } from '../../../core/commands/slash/registry.js';
import { createCoreSlashCommandModules } from '../../../core/commands/slash/modules/core-command-modules.js';
import type { SlashCommandExecutionContext } from '../../../core/commands/slash/modules/context.js';

function createContext(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  let activeModel = 'gpt-5.4';
  let driftEnabled = false;

  return {
    model: {
      active: () => activeModel,
      setActive: (model) => {
        activeModel = model;
      },
      credentialSource: () => undefined,
    },
    auth: {
      status: () => 'Auth store: test\nStored credentials: none',
      login: async (provider) => `Logged in ${provider}`,
      logout: (provider) => `Logged out ${provider}`,
    },
    compaction: {
      compactActive: () => 'Compacted history.',
    },
    drift: {
      status: () => ({ enabled: driftEnabled }),
      setEnabled: (enabled) => {
        driftEnabled = enabled;
      },
    },
    ...overrides,
  };
}

describe('core slash command modules', () => {
  const registry = createSlashCommandRegistry(createCoreSlashCommandModules());

  it('runs model commands through the registry and preserves compatibility aliases', async () => {
    const context = createContext();

    await expect(registry.run(context, '/model')).resolves.toMatchObject({
      kind: 'message',
      message: 'Current model: gpt-5.4',
    });
    await expect(registry.run(context, '/models')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('Common built-in model choices'),
    });
    await expect(registry.run(context, '/model gpt-5.4-mini')).resolves.toMatchObject({
      kind: 'message',
      message: 'Switched model to gpt-5.4-mini',
    });
    await expect(registry.run(context, '/model')).resolves.toMatchObject({
      message: 'Current model: gpt-5.4-mini',
    });
  });

  it('uses shared model credential policy before switching models', async () => {
    const setActive = vi.fn();
    const context = createContext({
      model: {
        active: () => 'gpt-5.4',
        setActive,
        credentialSource: () => ({
          type: 'oauth',
          provider: 'openai',
          accountId: 'acct',
          expiresAt: Date.now() + 60_000,
        }),
      },
    });

    await expect(registry.run(context, '/model gpt-5.4-pro')).resolves.toMatchObject({
      kind: 'message',
      message: expect.stringContaining('OpenAI account sign-in is not enabled for model gpt-5.4-pro'),
    });
    expect(setActive).not.toHaveBeenCalled();
  });

  it('routes auth, compaction, and drift commands through host ports', async () => {
    const context = createContext();

    await expect(registry.run(context, '/auth login openai')).resolves.toMatchObject({
      message: 'Logged in openai',
    });
    await expect(registry.run(context, '/compact')).resolves.toMatchObject({
      message: 'Compacted history.',
    });
    await expect(registry.run(context, '/drift on')).resolves.toMatchObject({
      message: expect.stringContaining('Enabled CyberLoop semantic drift detection'),
    });
    await expect(registry.run(context, '/drift status')).resolves.toMatchObject({
      message: expect.stringContaining('CyberLoop drift detection is enabled'),
    });
  });

  it('publishes module-owned help hints for host command surfaces', () => {
    expect(registry.hints()).toEqual(expect.arrayContaining([
      { command: '/model <name>', description: 'switch the current model' },
      { command: '/auth login openai', description: 'sign in with OpenAI ChatGPT/Codex OAuth' },
      { command: '/compact', description: 'compact earlier session history for the next run' },
      { command: '/drift', description: 'show CyberLoop semantic drift detection status' },
    ]));
  });
});
