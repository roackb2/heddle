import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseSessionArgs, runSessionCli } from '../../../cli/session.js';

describe('session CLI', () => {
  it('parses migrate subcommand', () => {
    expect(parseSessionArgs(['migrate'])).toEqual({ command: 'migrate' });
    expect(parseSessionArgs(['other'])).toEqual({ command: undefined });
  });

  it('migrates legacy sessions and reports preserved legacy file plus created catalog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-session-cli-'));
    const stateDir = '.heddle';
    mkdirSync(join(dir, stateDir), { recursive: true });
    const sessionsFile = join(dir, stateDir, 'chat-sessions.json');
    writeFileSync(sessionsFile, JSON.stringify([
      {
        id: 'session-1',
        name: 'Session 1',
        history: [],
        messages: [{ id: 'm1', role: 'assistant', text: 'hi' }],
        turns: [],
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T01:00:00.000Z',
      },
    ], null, 2));

    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      await runSessionCli(['migrate'], { workspaceRoot: dir, stateDir });
    } finally {
      writeSpy.mockRestore();
    }

    expect(readFileSync(join(dir, stateDir, 'chat-sessions.catalog.json'), 'utf8')).toContain('session-1');
    expect(readFileSync(join(dir, stateDir, 'chat-sessions.json'), 'utf8')).toContain('session-1');
  });
});
