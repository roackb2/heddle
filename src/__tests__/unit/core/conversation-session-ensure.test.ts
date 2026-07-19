import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConversationEngine } from '@/core/chat/engine/index.js';

describe('ConversationSessionService.ensure', () => {
  it('resolves two first-writer attempts to one stable session', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-ensure-race-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const firstEngine = createConversationEngine({
      model: 'gpt-test',
      stateRoot,
      workspaceRoot,
    });
    const secondEngine = createConversationEngine({
      model: 'gpt-test',
      stateRoot,
      workspaceRoot,
    });

    const resolutions = await Promise.all([
      firstEngine.sessions.ensure({ id: 'stable-session', name: 'First contender' }),
      secondEngine.sessions.ensure({ id: 'stable-session', name: 'Second contender' }),
    ]);

    expect(resolutions.filter((resolution) => resolution.created)).toHaveLength(1);
    expect(new Set(resolutions.map((resolution) => resolution.session.id))).toEqual(
      new Set(['stable-session']),
    );
    expect(new Set(resolutions.map((resolution) => resolution.session.name)).size).toBe(1);
  });

  it('does not overwrite an existing session with creation defaults', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-ensure-existing-'));
    const engine = createConversationEngine({
      model: 'gpt-default',
      stateRoot: join(workspaceRoot, '.heddle'),
      workspaceRoot,
    });
    const created = await engine.sessions.ensure({
      id: 'stable-session',
      model: 'gpt-original',
      name: 'Original name',
    });

    const resumed = await engine.sessions.ensure({
      id: 'stable-session',
      model: 'gpt-replacement',
      name: 'Replacement name',
    });

    expect(created.created).toBe(true);
    expect(resumed).toEqual({
      created: false,
      session: expect.objectContaining({
        id: 'stable-session',
        model: 'gpt-original',
        name: 'Original name',
      }),
    });
  });

  it('rejects an empty stable session id', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-ensure-empty-'));
    const engine = createConversationEngine({
      model: 'gpt-test',
      stateRoot: join(workspaceRoot, '.heddle'),
      workspaceRoot,
    });

    await expect(engine.sessions.ensure({ id: '   ' })).rejects.toThrow(
      'Conversation session ensure requires a non-empty id.',
    );
  });
});
