import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChatSession, loadChatSessions } from '../../../cli/chat/state/storage.js';
import { driftFooterColor, formatDriftFooter } from '../../../cli/chat/utils/drift-footer.js';

describe('chat drift defaults and footer formatting', () => {
  it('leaves CyberLoop drift detection disabled by default for new sessions', () => {
    const session = createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent: true,
    });

    expect(session.driftEnabled).toBe(false);
  });

  it('defaults old saved sessions without drift preference to disabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-drift-'));
    const sessionsFile = join(dir, 'sessions.json');
    writeFileSync(sessionsFile, JSON.stringify([{
      id: 'session-1',
      name: 'Session 1',
      history: [],
      messages: [],
      turns: [],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    }]));

    const [session] = loadChatSessions(sessionsFile, true);

    expect(session?.driftEnabled).toBe(false);
  });

  it('keeps explicit drift opt-out from saved sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heddle-chat-drift-'));
    const sessionsFile = join(dir, 'sessions.json');
    writeFileSync(sessionsFile, JSON.stringify([{
      id: 'session-1',
      name: 'Session 1',
      history: [],
      messages: [],
      turns: [],
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
      driftEnabled: false,
    }]));

    const [session] = loadChatSessions(sessionsFile, true);

    expect(session?.driftEnabled).toBe(false);
  });

  it('colors only medium and high drift footer states', () => {
    expect(formatDriftFooter(true, 'medium', undefined)).toBe('medium');
    expect(driftFooterColor(true, 'unknown', undefined)).toBeUndefined();
    expect(driftFooterColor(true, 'low', undefined)).toBeUndefined();
    expect(driftFooterColor(true, 'medium', undefined)).toBe('yellow');
    expect(driftFooterColor(true, 'high', undefined)).toBe('red');
    expect(driftFooterColor(true, 'high', 'missing cyberloop')).toBeUndefined();
    expect(driftFooterColor(false, 'high', undefined)).toBeUndefined();
  });
});
