import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationEngine } from '../../../core/chat/engine/conversation-engine.js';
import { defineHostExtension } from '../../../core/chat/engine/host-extension.js';
import { EngineConversationTurnService } from '../../../core/chat/engine/turns/service.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import type { TraceEvent } from '../../../core/types.js';
import { FileChatSessionRepository } from '../../../core/chat/engine/sessions/repository/index.js';
import type { ChatSession } from '../../../core/chat/types.js';
import { TraceSummaryService } from '@/core/observability/index.js';
import type { LlmAdapter } from '@/core/llm/types.js';
import type { ToolDefinition } from '../../../core/types.js';
import type { ToolToolkit } from '../../../core/tools/index.js';

describe('createConversationEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(EngineConversationTurnService, 'run').mockImplementation(async (args) => ({
      outcome: 'done',
      summary: 'ok',
      session: new FileChatSessionRepository({ sessionStoragePath: args.sessionStoragePath })
        .read(args.sessionId) as ChatSession,
      artifacts: [],
      toolResults: [],
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

    expect(engine.sessions.listExisting()).toEqual([]);
    const fallback = engine.sessions.latest();
    expect(fallback).toEqual(expect.objectContaining({
      id: 'session-1',
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
    }));
    expect(engine.sessions.require('session-1')).toEqual(expect.objectContaining({
      id: 'session-1',
      model: 'gpt-5.4',
    }));

    const session = engine.sessions.create({ name: 'Repo investigation' });

    expect(engine.sessions.listExisting().map((candidate) => candidate.id)).toEqual([session.id, 'session-1']);
    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    expect(sessionRepository.readCatalog()[0]).toEqual(expect.objectContaining({
      id: session.id,
      name: 'Repo investigation',
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
    }));
    expect(sessionRepository.read(session.id)).toEqual(expect.objectContaining({
      id: session.id,
      model: 'gpt-5.4',
      workspaceId: 'workspace-1',
      history: [],
      messages: [],
    }));
  });

  it('passes host extensions into submitted turns', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-host-tools-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const hostTools = [tool('host_create_document')];
    const hostToolkits: ToolToolkit[] = [{
      id: 'host.documents',
      createTools: () => [tool('host_validate_document')],
    }];
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      systemContext: 'Base context',
      hostExtensions: {
        tools: hostTools,
        toolkits: hostToolkits,
        systemContext: 'Host context',
        artifacts: {
          root: join(stateRoot, 'custom-artifacts'),
          enabled: false,
        },
        mcp: {
          hideDefaultServers: ['deck_service'],
        },
      },
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Host tools' });

    await engine.turns.submit({
      sessionId: session.id,
      prompt: 'Create a deck',
    });

    expect(EngineConversationTurnService.run).toHaveBeenCalledWith(expect.objectContaining({
      tools: hostTools,
      toolkits: hostToolkits,
      systemContext: 'Base context\n\nHost context',
      artifactRoot: join(stateRoot, 'custom-artifacts'),
      artifactsEnabled: false,
      hiddenMcpServerIds: ['deck_service'],
      sessionId: session.id,
      prompt: 'Create a deck',
    }));
  });

  it('composes multiple host extensions into submitted turns in declaration order', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-host-extension-array-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const reportTool = tool('report_generate');
    const reviewTool = tool('report_review');
    const reportToolkit: ToolToolkit = {
      id: 'report.workspace',
      createTools: () => [tool('report_validate')],
    };
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      systemContext: 'Base context',
      hostExtensions: [
        defineHostExtension({
          id: 'reporting',
          tools: [reportTool],
          toolkits: [reportToolkit],
          systemContext: 'Use report workspace tools for report outputs.',
          artifacts: {
            root: join(stateRoot, 'report-artifacts'),
          },
        }),
        defineHostExtension({
          id: 'review',
          tools: [reviewTool],
          systemContext: 'Review reports before finalizing them.',
          artifacts: {
            enabled: false,
          },
        }),
      ],
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Host extension array' });

    await engine.turns.submit({
      sessionId: session.id,
      prompt: 'Create a report',
    });

    expect(EngineConversationTurnService.run).toHaveBeenCalledWith(expect.objectContaining({
      tools: [reportTool, reviewTool],
      toolkits: [reportToolkit],
      systemContext: [
        'Base context',
        'Use report workspace tools for report outputs.',
        'Review reports before finalizing them.',
      ].join('\n\n'),
      artifactRoot: join(stateRoot, 'report-artifacts'),
      artifactsEnabled: false,
      sessionId: session.id,
      prompt: 'Create a report',
    }));
  });

  it('rejects invalid or conflicting host extension definitions before turns run', () => {
    expect(() => defineHostExtension({
      id: 'invalid id',
    })).toThrow('Invalid host extension id: invalid id');

    expect(() => createConversationEngine({
      workspaceRoot: mkdtempSync(join(tmpdir(), 'heddle-engine-duplicate-extension-')),
      stateRoot: mkdtempSync(join(tmpdir(), 'heddle-engine-state-')),
      model: 'gpt-5.4',
      hostExtensions: [
        defineHostExtension({ id: 'reporting' }),
        defineHostExtension({ id: 'reporting' }),
      ],
      apiKeyPresent: true,
    })).toThrow('Duplicate host extension id: reporting');

    expect(() => createConversationEngine({
      workspaceRoot: mkdtempSync(join(tmpdir(), 'heddle-engine-duplicate-extension-tool-')),
      stateRoot: mkdtempSync(join(tmpdir(), 'heddle-engine-state-')),
      model: 'gpt-5.4',
      hostExtensions: [
        defineHostExtension({ id: 'reporting', tools: [tool('shared_tool')] }),
        defineHostExtension({ id: 'review', tools: [tool('shared_tool')] }),
      ],
      apiKeyPresent: true,
    })).toThrow('Duplicate host extension tool name: shared_tool');

    expect(() => createConversationEngine({
      workspaceRoot: mkdtempSync(join(tmpdir(), 'heddle-engine-duplicate-extension-toolkit-')),
      stateRoot: mkdtempSync(join(tmpdir(), 'heddle-engine-state-')),
      model: 'gpt-5.4',
      hostExtensions: [
        defineHostExtension({ id: 'reporting', toolkits: [{ id: 'shared.toolkit', createTools: () => [] }] }),
        defineHostExtension({ id: 'review', toolkits: [{ id: 'shared.toolkit', createTools: () => [] }] }),
      ],
      apiKeyPresent: true,
    })).toThrow('Duplicate host extension toolkit id: shared.toolkit');
  });

  it('keeps top-level host tools as a compatibility input', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-legacy-host-tools-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const hostTools = [tool('legacy_host_tool')];
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      tools: hostTools,
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Legacy host tools' });

    await engine.turns.submit({
      sessionId: session.id,
      prompt: 'Use host tool',
    });

    expect(EngineConversationTurnService.run).toHaveBeenCalledWith(expect.objectContaining({
      tools: hostTools,
      artifactRoot: join(stateRoot, 'artifacts'),
      artifactsEnabled: true,
    }));
  });

  it('lists sessions in persisted storage order, reads missing sessions as undefined, updates, renames, and deletes with fallback', () => {
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

    expect(engine.sessions.list().map((session) => session.id)).toEqual(['session-b', 'session-a']);
    expect(engine.sessions.latest()?.id).toBe(engine.sessions.list()[0]?.id);
    expect(engine.sessions.read('missing')).toBeUndefined();
    expect(engine.sessions.require(first.id).id).toBe(first.id);
    expect(() => engine.sessions.require('missing')).toThrow('Chat session not found: missing');

    const updated = engine.sessions.update(first.id, (session) => ({
      ...session,
      driftEnabled: true,
    }));
    expect(updated?.driftEnabled).toBe(true);
    expect(engine.sessions.read(first.id)?.driftEnabled).toBe(true);

    const renamed = engine.sessions.rename(first.id, 'Renamed');
    expect(renamed.name).toBe('Renamed');
    expect(engine.sessions.read(first.id)?.name).toBe('Renamed');

    const archived = engine.sessions.setArchived(first.id, true);
    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(engine.sessions.list().map((session) => session.id)).toEqual(['session-b']);
    expect(engine.sessions.read(first.id)?.archivedAt).toBe(archived.archivedAt);
    expect(engine.sessions.setArchived(first.id, false).archivedAt).toBeUndefined();
    expect(engine.sessions.list().map((session) => session.id)).toEqual(['session-a', 'session-b']);

    expect(engine.sessions.delete(second.id)).toBe(true);
    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    expect(sessionRepository.list().map((session) => session.id)).toEqual(['session-a']);
    expect(engine.sessions.delete(first.id)).toBe(true);
    expect(engine.sessions.delete('session-1')).toBe(true);
    expect(engine.sessions.delete('missing')).toBe(false);
    expect(sessionRepository.list().map((session) => session.id)).toEqual(['session-1']);
  });

  it('updates shared session settings for TUI and control-plane clients', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({
      id: 'session-1',
      name: 'Alpha',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });

    const updated = engine.sessions.updateSettings(session.id, {
      model: 'gpt-5.5',
      reasoningEffort: null,
      driftEnabled: true,
    });

    expect(updated).toEqual(expect.objectContaining({
      id: session.id,
      name: 'Alpha',
      model: 'gpt-5.5',
      reasoningEffort: undefined,
      driftEnabled: true,
      history: session.history,
      messages: session.messages,
      turns: session.turns,
    }));
    expect(engine.sessions.read(session.id)).toEqual(expect.objectContaining({
      model: 'gpt-5.5',
      reasoningEffort: undefined,
      driftEnabled: true,
    }));
    expect(() => engine.sessions.updateSettings('missing', { driftEnabled: false })).toThrow(
      'Chat session not found: missing',
    );
  });

  it('auto-renames generic sessions after the first user message', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Session 1' });
    engine.sessions.update(session.id, (current) => ({
      ...current,
      history: [
        { role: 'user', content: 'Inspect the architecture docs' },
        { role: 'assistant', content: 'The architecture docs place shared chat policy in core.' },
      ],
    }));

    const result = await engine.sessions.autoRenameAfterFirstUserMessage(session.id, {
      llm: fakeTitleLlm('Architecture Docs Review!!!'),
      prompt: 'Inspect the architecture docs',
      responseText: 'Shared chat policy belongs in core.',
    });

    expect(result.renamed).toBe(true);
    expect(engine.sessions.require(session.id).name).toBe('Architecture Docs Review!!!');
  });

  it('does not auto-rename custom sessions or later multi-message sessions', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const custom = engine.sessions.create({ id: 'custom-session', name: 'Manual Investigation' });
    const later = engine.sessions.create({ id: 'later-session', name: 'Session 42' });
    engine.sessions.update(custom.id, (session) => ({
      ...session,
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'done' },
      ],
    }));
    engine.sessions.update(later.id, (session) => ({
      ...session,
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'done again' },
      ],
    }));
    const llm = fakeTitleLlm('Generated Title');

    await expect(engine.sessions.autoRenameAfterFirstUserMessage(custom.id, {
      llm,
      prompt: 'first',
      responseText: 'done',
    })).resolves.toEqual({ renamed: false, session: expect.objectContaining({ name: 'Manual Investigation' }) });
    await expect(engine.sessions.autoRenameAfterFirstUserMessage(later.id, {
      llm,
      prompt: 'second',
      responseText: 'done again',
    })).resolves.toEqual({ renamed: false, session: expect.objectContaining({ name: 'Session 42' }) });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('does not overwrite a manual rename while title generation is running', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Session 1' });
    engine.sessions.update(session.id, (current) => ({
      ...current,
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'done' },
      ],
    }));
    let resolveTitle: (value: { content: string }) => void = () => undefined;
    const llm: LlmAdapter = {
      chat: vi.fn(() => new Promise((resolve) => {
        resolveTitle = resolve;
      })),
    };

    const pending = engine.sessions.autoRenameAfterFirstUserMessage(session.id, {
      llm,
      prompt: 'first',
      responseText: 'done',
    });
    engine.sessions.rename(session.id, 'Manual Rename');
    resolveTitle({ content: 'Generated Rename' });

    await expect(pending).resolves.toEqual({ renamed: false, session: expect.objectContaining({ name: 'Manual Rename' }) });
    expect(engine.sessions.require(session.id).name).toBe('Manual Rename');
  });

  it('owns persisted conversation message, reset, continue prompt, and drift mutations', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });

    const withUserMessage = engine.sessions.appendMessage(session.id, {
      id: 'message-1',
      role: 'user',
      text: 'Inspect README',
    });
    expect(withUserMessage.messages.at(-1)).toEqual({
      id: 'message-1',
      role: 'user',
      text: 'Inspect README',
    });

    const withAssistantMessages = engine.sessions.appendMessages(session.id, [
      {
        id: 'message-2',
        role: 'assistant',
        text: 'Looking now',
        isStreaming: true,
      },
      {
        id: 'message-3',
        role: 'assistant',
        text: 'Done',
      },
    ]);
    expect(withAssistantMessages.messages.slice(-2)).toEqual([
      {
        id: 'message-2',
        role: 'assistant',
        text: 'Looking now',
        isStreaming: true,
      },
      {
        id: 'message-3',
        role: 'assistant',
        text: 'Done',
      },
    ]);

    const withPrompt = engine.sessions.setLastContinuePrompt(session.id, 'Continue the repo read');
    expect(withPrompt.lastContinuePrompt).toBe('Continue the repo read');

    const withDrift = engine.sessions.setDriftEnabled(session.id, true);
    expect(withDrift.driftEnabled).toBe(true);

    const reset = engine.sessions.resetConversation(session.id);
    expect(reset.history).toEqual([]);
    expect(reset.turns).toEqual([]);
    expect(reset.lastContinuePrompt).toBeUndefined();
    expect(reset.messages).toEqual([]);
    expect(engine.sessions.read(session.id)).toEqual(expect.objectContaining({
      driftEnabled: true,
      messages: [],
    }));
  });

  it('owns persisted compaction state transitions', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });
    const sourceHistory = [{ role: 'user' as const, content: 'Inspect README' }];
    const previousState = engine.sessions.update(session.id, (current) => ({
      ...current,
      context: {
        estimatedHistoryTokens: 7,
        compaction: { status: 'idle' },
        archive: {
          currentSummaryPath: '.heddle/chat-sessions/session-1/current-summary.md',
        },
      },
      archives: [
        {
          id: 'archive-1',
          path: '.heddle/chat-sessions/session-1/archive.jsonl',
          summaryPath: '.heddle/chat-sessions/session-1/archive-summary.md',
          messageCount: 2,
          createdAt: '2026-05-15T00:00:00.000Z',
        },
      ],
    }))!;

    const running = engine.sessions.markCompactionRunning(session.id, {
      sourceHistory,
      archivePath: '.heddle/chat-sessions/session-1/archive.jsonl',
    });
    expect(running.history).toEqual(sourceHistory);
    expect(running.context).toEqual(expect.objectContaining({
      compaction: expect.objectContaining({ status: 'running' }),
      archive: expect.objectContaining({ lastArchivePath: '.heddle/chat-sessions/session-1/archive.jsonl' }),
    }));

    const compacted = engine.sessions.applyCompactionResult(session.id, {
      history: [
        { role: 'user', content: 'Short prompt' },
        { role: 'assistant', content: 'Short answer' },
      ],
      context: {
        estimatedHistoryTokens: 4,
        compaction: { status: 'idle' },
      },
      archive: {
        archives: [],
      },
    });
    expect(compacted.messages.map((message) => message.text)).toEqual(['Short prompt', 'Short answer']);
    expect(compacted.context?.compaction?.status).toBe('idle');

    const restored = engine.sessions.restoreCompactionState(session.id, {
      context: previousState.context,
      archives: previousState.archives,
    });
    expect(restored.context).toEqual(previousState.context);
    expect(restored.archives).toEqual(previousState.archives);
  });

  it('owns session lease conflict, acquire, and release semantics', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });
    const owner = {
      ownerKind: 'tui' as const,
      ownerId: 'tui-test-client',
      clientLabel: 'terminal chat',
    };
    const otherOwner = {
      ownerKind: 'daemon' as const,
      ownerId: 'daemon-1',
      clientLabel: 'control plane',
    };

    expect(engine.sessions.getLeaseConflict(session.id, owner)).toBeUndefined();
    const leased = engine.sessions.acquireLease(session.id, owner);
    expect(leased.lease).toEqual(expect.objectContaining({
      ownerKind: 'tui',
      ownerId: 'tui-test-client',
      clientLabel: 'terminal chat',
    }));
    expect(engine.sessions.getLeaseConflict(session.id, otherOwner)).toContain(
      'Session session-1 is already active in terminal chat.',
    );
    expect(() => engine.sessions.acquireLease(session.id, otherOwner)).toThrow(
      'Session session-1 is already active in terminal chat.',
    );

    const refreshed = engine.sessions.refreshLease(session.id, owner);
    expect(refreshed.lease?.ownerId).toBe('tui-test-client');

    const stillLeased = engine.sessions.releaseLease(session.id, { ownerId: 'daemon-1' });
    expect(stillLeased.lease?.ownerId).toBe('tui-test-client');

    const released = engine.sessions.releaseLease(session.id, owner);
    expect(released.lease).toBeUndefined();
    expect(engine.sessions.read(session.id)?.lease).toBeUndefined();
  });

  it('submits turns with merged engine defaults, normalized host callbacks, and override options', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const approvalPolicies = [vi.fn()];
    const traceSummarizerRegistry = new TraceSummaryService({ 'run.started': () => [] });
    vi.spyOn(traceSummarizerRegistry, 'summarizeTrace').mockReturnValue([]);
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
      traceSummarizerRegistry,
      workspaceId: 'workspace-1',
      apiKeyPresent: true,
    });
    const session = engine.sessions.create({ id: 'session-1', name: 'Alpha' });
    const onActivity = vi.fn();
    const onEvent = vi.fn();
    const onTraceEvent = vi.fn();
    const onCompactionStatus = vi.fn();
    const requestToolApproval = vi.fn(async () => ({ approved: true, reason: 'ok' }));
    const overridePolicies = [vi.fn()];
    const overrideRegistry = new TraceSummaryService({ 'run.started': () => [] });
    vi.spyOn(overrideRegistry, 'summarizeTrace').mockReturnValue([]);

    await engine.turns.submit({
      sessionId: session.id,
      prompt: 'Summarize the repo.',
      memoryMaintenanceMode: 'inline',
      approvalPolicies: overridePolicies as never,
      traceSummarizerRegistry: overrideRegistry,
      host: {
        events: {
          onActivity,
          onEvent,
        },
        approvals: {
          requestToolApproval,
        },
        compaction: {
          onStatus: onCompactionStatus,
        },
        trace: {
          onEvent: onTraceEvent,
        },
      },
    });

    const runSpy = vi.mocked(EngineConversationTurnService.run);
    const args = runSpy.mock.calls[0]?.[0];
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
    expect(typeof args.onTraceEvent).toBe('function');
    expect(args.traceDir).toBe(join(stateRoot, 'traces'));
    expect(args.host).toBeTruthy();
    expect(typeof args.host.approveToolCall).toBe('function');

    const loopEvent: AgentLoopEvent = {
      source: 'agent-loop',
      type: 'assistant.stream',
      runId: 'run-1',
      step: 1,
      text: 'partial',
      done: false,
      timestamp: '2026-05-03T00:00:00.000Z',
    };
    args.host.onEvent(loopEvent);
    expect(onEvent).toHaveBeenCalledWith(loopEvent);
    expect(onActivity).toHaveBeenCalledWith(loopEvent);

    const traceEvent: TraceEvent = {
      type: 'tool.calling',
      step: 1,
      timestamp: '2026-05-03T00:00:01.000Z',
      call: { id: 'call-1', tool: 'read_file', input: { path: 'README.md' } },
      requiresApproval: false,
    };
    args.onTraceEvent(traceEvent);
    expect(onTraceEvent).toHaveBeenCalledWith(traceEvent);
    expect(onActivity).toHaveBeenCalledTimes(1);

    const compactionActivity = {
      source: 'compaction' as const,
      type: 'compaction.finished' as const,
      status: 'finished' as const,
      summaryPath: '/tmp/summary.md',
    };
    args.host.onCompactionStatus(compactionActivity, 'final');
    expect(onCompactionStatus).toHaveBeenCalledWith(compactionActivity);
    expect(onActivity.mock.calls.at(-1)?.[0]).toEqual(compactionActivity);
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

    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    const stored = sessionRepository.read(session.id) as ChatSession;
    stored.lastContinuePrompt = 'continue investigating';
    stored.history = [{ role: 'user', content: 'prior' }];
    stored.updatedAt = '2026-05-03T00:00:00.000Z';
    const otherSessions = sessionRepository.list()
      .filter((candidate) => candidate.id !== session.id);
    sessionRepository.save([stored, ...otherSessions]);

    await engine.turns.continue({ sessionId: session.id });
    const runSpy = vi.mocked(EngineConversationTurnService.run);
    expect(runSpy.mock.calls[0]?.[0]?.prompt).toBe('continue investigating');

    await engine.turns.continue({ sessionId: session.id, prompt: 'override prompt' });
    expect(runSpy.mock.calls[1]?.[0]?.prompt).toBe('override prompt');
  });

  it('clears leases through the turn service boundary', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-engine-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: 'gpt-5.4',
      apiKeyPresent: true,
    });

    expect(() => engine.turns.clearLease({
      sessionId: 'missing',
      owner: { ownerKind: 'daemon', ownerId: 'daemon-1', clientLabel: 'control plane' },
    })).not.toThrow();

    const session = engine.sessions.create({ id: 'session-1', name: 'Leased' });
    engine.sessions.acquireLease(session.id, {
      ownerKind: 'daemon',
      ownerId: 'daemon-1',
      clientLabel: 'control plane',
    });

    engine.turns.clearLease({
      sessionId: 'session-1',
      owner: { ownerKind: 'daemon', ownerId: 'daemon-1', clientLabel: 'control plane' },
    });

    const sessionRepository = new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    });
    expect(sessionRepository.read('session-1')?.lease).toBeUndefined();
  });
});

function tool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: {},
    execute: async () => ({ ok: true }),
  };
}

function fakeTitleLlm(title: string): LlmAdapter {
  return {
    chat: vi.fn(async () => ({ content: title })),
  };
}
