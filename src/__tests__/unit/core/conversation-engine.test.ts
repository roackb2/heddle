import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationEngine } from '../../../core/chat/engine/conversation-engine.js';
import type { AgentLoopEvent } from '../../../core/runtime/events.js';
import type { TraceEvent } from '../../../core/types.js';
import { loadChatSessions, readChatSession, readChatSessionCatalog } from '../../../core/chat/storage.js';
import type { ChatSession } from '../../../core/chat/types.js';

const runConversationTurnMock = vi.hoisted(() => vi.fn());
const clearConversationTurnLeaseMock = vi.hoisted(() => vi.fn());

vi.mock('../../../core/chat/conversation-turn.js', () => ({
  runConversationTurn: runConversationTurnMock,
  clearConversationTurnLease: clearConversationTurnLeaseMock,
}));

describe('createConversationEngine', () => {
  beforeEach(() => {
    runConversationTurnMock.mockReset();
    clearConversationTurnLeaseMock.mockReset();
    runConversationTurnMock.mockImplementation(async (args: { sessionStoragePath: string; sessionId: string }) => ({
      outcome: 'done',
      summary: 'ok',
      session: readChatSession(args.sessionStoragePath, args.sessionId, true) as ChatSession,
    }));
  });

  it('derives the default session storage path from stateRoot and persists session defaults', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
      apiKeyPresent: true,
    });

    const session = engine.sessions.create({ name: 'Repo investigation' });

    expect(readChatSessionCatalog(join(stateRoot, 'chat-sessions.catalog.json'))[0]).toEqual(expect.objectContaining({
      id: session.id,
      name: 'Repo investigation',
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
    }));
    expect(readChatSession(join(stateRoot, 'chat-sessions.catalog.json'), session.id, true)).toEqual(expect.objectContaining({
      id: session.id,
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
    }));
  });

  it('lists sessions in persisted storage order, reads missing sessions as undefined, renames, and deletes', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });

    const first = engine.sessions.create({ id: 'session-a', name: 'First' });
    const second = engine.sessions.create({ id: 'session-b', name: 'Second' });

    expect(engine.sessions.list().map((session) => session.id)).toEqual(['session-b', 'session-a', 'session-1']);
    expect(engine.sessions.read('missing')).toBeUndefined();

    const renamed = engine.sessions.rename(first.id, 'Renamed');
    expect(renamed.name).toBe('Renamed');
    expect(engine.sessions.read(first.id)?.name).toBe('Renamed');

    expect(engine.sessions.delete(second.id)).toBe(true);
    expect(engine.sessions.delete('missing')).toBe(false);
    expect(loadChatSessions(join(stateRoot, 'chat-sessions.catalog.json'), true).map((session) => session.id)).toEqual(['session-a', 'session-1']);
  });

  it('submits turns with merged engine defaults, normalized host callbacks, and override options', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const approvalPolicies = [vi.fn()];
    const traceSummarizerRegistry = { summarize: vi.fn() } as unknown as { summarize: (event: TraceEvent) => string | undefined };
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKey: 'engine-key',
      preferApiKey: true,
      credentialStorePath: join(stateRoot, 'auth.json'),
      systemContext: 'Engine system context',
      memoryMaintenanceMode: 'background',
      approvalPolicies,
      traceSummarizerRegistry: traceSummarizerRegistry as never,
      workspaceId: 'workspace-1',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });
    const onActivity = vi.fn();
    const onAgentLoopEvent = vi.fn();
    const onTraceEvent = vi.fn();
    const onAssistantText = vi.fn();
    const onCompactionStatus = vi.fn();
    const requestToolApproval = vi.fn(async () => ({ approved: true, reason: 'ok' }));
    const overridePolicies = [vi.fn()];
    const overrideRegistry = { summarize: vi.fn() } as unknown as { summarize: (event: TraceEvent) => string | undefined };

    await engine.turns.submit({
      sessionId: session.id,
      prompt: 'Summarize the repo.',
      memoryMaintenanceMode: 'inline',
      approvalPolicies: overridePolicies as never,
      traceSummarizerRegistry: overrideRegistry as never,
      host: {
        events: {
          onActivity,
          onAgentLoopEvent,
        },
        approvals: {
          requestToolApproval,
        },
        compaction: {
          onStatus: onCompactionStatus,
        },
        assistant: {
          onText: onAssistantText,
        },
        trace: {
          onEvent: onTraceEvent,
        },
      },
    });

    const args = runConversationTurnMock.mock.calls[0]?.[0];
    expect(args).toEqual(expect.objectContaining({
      workspaceRoot,
      stateRoot,
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
      sessionId: session.id,
      prompt: 'Summarize the repo.',
      apiKey: 'engine-key',
      preferApiKey: true,
      credentialStorePath: join(stateRoot, 'auth.json'),
      systemContext: 'Engine system context',
      memoryMaintenanceMode: 'inline',
      approvalPolicies: overridePolicies,
      traceSummarizerRegistry: overrideRegistry,
    }));
    expect(typeof args.onAssistantStream).toBe('function');
    expect(typeof args.onTraceEvent).toBe('function');
    expect(typeof args.onCompactionStatus).toBe('function');
    expect(args.host).toBeTruthy();
    expect(args.host.approvals.requestToolApproval).toBe(requestToolApproval);

    const loopEvent: AgentLoopEvent = {
      type: 'assistant.stream',
      runId: 'run-1',
      text: 'partial',
      done: false,
      timestamp: '2026-05-03T00:00:00.000Z',
    };
    args.host.events.onAgentLoopEvent(loopEvent);
    expect(onAgentLoopEvent).toHaveBeenCalledWith(loopEvent);
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'assistant.stream', text: 'partial' }));

    args.onAssistantStream('hello');
    expect(onAssistantText).toHaveBeenCalledWith('hello');

    const traceEvent: TraceEvent = {
      type: 'tool.call',
      step: 1,
      timestamp: '2026-05-03T00:00:01.000Z',
      call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
    };
    args.onTraceEvent(traceEvent);
    expect(onTraceEvent).toHaveBeenCalledWith(traceEvent);
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool.call' }));

    args.onCompactionStatus({ status: 'finished', summaryPath: '/tmp/summary.md' });
    expect(onCompactionStatus).toHaveBeenCalledWith({ status: 'finished', summaryPath: '/tmp/summary.md' });
    expect(onActivity.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      type: 'compaction.finished',
      summaryPath: '/tmp/summary.md',
    }));
  });

  it('continues from the persisted lastContinuePrompt and errors clearly when missing', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });

    await expect(engine.turns.continue({ sessionId: session.id })).rejects.toThrow(
      'There is no interrupted or prior run to continue yet.',
    );

    const stored = readChatSession(join(stateRoot, 'chat-sessions.catalog.json'), session.id, true) as ChatSession;
    stored.lastContinuePrompt = 'continue investigating';
    stored.history = [{ role: 'user', content: 'prior' }];
    stored.updatedAt = '2026-05-03T00:00:00.000Z';
    const otherSessions = loadChatSessions(join(stateRoot, 'chat-sessions.catalog.json'), true)
      .filter((candidate) => candidate.id !== session.id);
    const { saveChatSessions } = await import('../../../core/chat/storage.js');
    saveChatSessions(join(stateRoot, 'chat-sessions.catalog.json'), [stored, ...otherSessions]);

    await engine.turns.continue({ sessionId: session.id });
    expect(runConversationTurnMock.mock.calls[0]?.[0]?.prompt).toBe('continue investigating');

    await engine.turns.continue({ sessionId: session.id, prompt: 'override prompt' });
    expect(runConversationTurnMock.mock.calls[1]?.[0]?.prompt).toBe('override prompt');
  });

  it('clears leases through the renamed low-level helper', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });

    engine.turns.clearLease({
      sessionId: 'session-1',
      owner: { ownerKind: 'daemon', ownerId: 'daemon-1', clientLabel: 'control plane' },
    });

    expect(clearConversationTurnLeaseMock).toHaveBeenCalledWith(
      join(stateRoot, 'chat-sessions.catalog.json'),
      'session-1',
      { ownerKind: 'daemon', ownerId: 'daemon-1', clientLabel: 'control plane' },
    );
  });
});
