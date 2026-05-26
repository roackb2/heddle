import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationCompactionService } from '@/core/chat/engine/compaction/index.js';
import { createConversationEngine } from '@/core/chat/engine/conversation-engine.js';
import type { ChatSessionLeaseOwner } from '@/core/chat/engine/sessions/leases/index.js';
import { DEFAULT_WORKSPACE_ID, RuntimeWorkspaceService, type WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { controlPlaneRouter } from '@/server/routes/trpc/control-plane.js';
import type { HeddleServerContext } from '@/server/types.js';

const EXTERNAL_TUI_LEASE_OWNER: ChatSessionLeaseOwner = {
  ownerKind: 'tui',
  ownerId: 'external-tui-client',
  clientLabel: 'terminal chat',
};

describe('control-plane session lifecycle API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renames sessions through the workspace-scoped API', async () => {
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Original name' });

    const renamed = await caller.sessionRename({
      id: session.id,
      name: 'Renamed from API',
    });

    expect(renamed.name).toBe('Renamed from API');
    await expect(caller.session({ id: session.id })).resolves.toMatchObject({
      id: session.id,
      name: 'Renamed from API',
    });
  });

  it('scopes lifecycle mutations to the requested workspace', async () => {
    const { caller, secondaryWorkspace, createEngineForWorkspace } = createControlPlaneCaller();
    const defaultEngine = createEngineForWorkspace(DEFAULT_WORKSPACE_ID);
    const secondaryEngine = createEngineForWorkspace(secondaryWorkspace.id);
    defaultEngine.sessions.create({
      id: 'same-session-id',
      name: 'Default workspace session',
      apiKeyPresent: true,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    secondaryEngine.sessions.create({
      id: 'same-session-id',
      name: 'Secondary workspace session',
      apiKeyPresent: true,
      workspaceId: secondaryWorkspace.id,
    });

    await caller.sessionRename({
      workspaceId: secondaryWorkspace.id,
      id: 'same-session-id',
      name: 'Renamed secondary session',
    });

    await expect(caller.session({ workspaceId: DEFAULT_WORKSPACE_ID, id: 'same-session-id' })).resolves.toMatchObject({
      id: 'same-session-id',
      name: 'Default workspace session',
    });
    await expect(caller.session({ workspaceId: secondaryWorkspace.id, id: 'same-session-id' })).resolves.toMatchObject({
      id: 'same-session-id',
      name: 'Renamed secondary session',
    });
  });

  it('deletes sessions and leaves the session catalog readable', async () => {
    const { caller } = createControlPlaneCaller();
    const deletedSession = await caller.sessionCreate({ name: 'Delete me' });
    const keptSession = await caller.sessionCreate({ name: 'Keep me' });

    await expect(caller.sessionDelete({ id: deletedSession.id })).resolves.toEqual({ deleted: true });

    const sessions = await caller.sessions();
    expect(sessions.sessions.map((session) => session.id)).toContain(keptSession.id);
    expect(sessions.sessions.map((session) => session.id)).not.toContain(deletedSession.id);
    await expect(caller.session({ id: deletedSession.id })).resolves.toBeNull();
  });

  it('resets session transcript state through the API', async () => {
    const { caller, engine } = createControlPlaneCaller();
    const session = engine.sessions.create({
      id: 'session-reset-api',
      name: 'Reset API session',
      apiKeyPresent: true,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    engine.sessions.appendMessage(session.id, {
      id: 'local-user-message',
      role: 'user',
      text: 'old visible message',
    });
    engine.sessions.setLastContinuePrompt(session.id, 'continue old work');

    const reset = await caller.sessionReset({ id: session.id });

    expect(reset.messages.map((message) => message.text)).not.toContain('old visible message');
    expect(reset.turns).toEqual([]);
    expect(reset.lastContinuePrompt).toBeUndefined();
    await expect(caller.session({ id: session.id })).resolves.toMatchObject({
      id: session.id,
      turns: [],
    });
  });

  it('blocks destructive lifecycle mutations while another client owns the session lease', async () => {
    const { caller, engine } = createControlPlaneCaller();
    const session = engine.sessions.create({
      id: 'leased-session-api',
      name: 'Leased API session',
      apiKeyPresent: true,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    engine.sessions.acquireLease(session.id, EXTERNAL_TUI_LEASE_OWNER);

    await expect(caller.sessionDelete({ id: session.id })).rejects.toThrow('already active');
    await expect(caller.sessionReset({ id: session.id })).rejects.toThrow('already active');
    await expect(caller.sessionCompact({ id: session.id, force: true })).rejects.toThrow('already active');
    await expect(caller.sessionRunState({ id: session.id })).resolves.toEqual({
      running: false,
      pendingApproval: null,
    });
  });

  it('compacts a session through the API without requiring clients to call compaction services', async () => {
    const { caller, engine } = createControlPlaneCaller();
    const session = engine.sessions.create({
      id: 'session-compact-api',
      name: 'Compact API session',
      apiKeyPresent: true,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    engine.sessions.update(session.id, (current) => ({
      ...current,
      history: [
        { role: 'user', content: 'summarize this small transcript' },
        { role: 'assistant', content: 'small transcript response' },
      ],
    }));

    const compacted = await caller.sessionCompact({ id: session.id, force: true });

    expect(compacted.id).toBe(session.id);
    expect(compacted.context?.estimatedHistoryTokens).toEqual(expect.any(Number));
    await expect(caller.session({ id: session.id })).resolves.toMatchObject({
      id: session.id,
      context: expect.objectContaining({
        estimatedHistoryTokens: expect.any(Number),
      }),
    });
  });

  it('restores prior compaction state when manual compaction fails', async () => {
    const { caller, engine } = createControlPlaneCaller();
    const session = engine.sessions.create({
      id: 'session-compact-failure-api',
      name: 'Compact failure API session',
      apiKeyPresent: true,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    const priorContext = {
      estimatedHistoryTokens: 42,
      compaction: { status: 'idle' as const },
      archive: { count: 1, currentSummaryPath: '.heddle/archive-summary.md' },
    };
    const priorArchives = [{
      id: 'archive-1',
      path: '.heddle/archive-1.jsonl',
      summaryPath: '.heddle/archive-summary.md',
      messageCount: 2,
      createdAt: '2026-05-26T00:00:00.000Z',
    }];
    engine.sessions.update(session.id, (current) => ({
      ...current,
      history: [{ role: 'user', content: 'please compact then fail' }],
      context: priorContext,
      archives: priorArchives,
    }));
    vi.spyOn(ConversationCompactionService, 'compact').mockRejectedValueOnce(new Error('forced compaction failure'));

    await expect(caller.sessionCompact({ id: session.id, force: true })).rejects.toThrow('forced compaction failure');
    expect(engine.sessions.require(session.id).context).toEqual(priorContext);
    expect(engine.sessions.require(session.id).archives).toEqual(priorArchives);
  });

  it('returns combined run state for a session', async () => {
    const { caller } = createControlPlaneCaller();
    const session = await caller.sessionCreate({ name: 'Run state session' });

    await expect(caller.sessionRunState({ id: session.id })).resolves.toEqual({
      running: false,
      pendingApproval: null,
    });
  });
});

function createControlPlaneCaller() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-lifecycle-'));
  const stateRoot = join(workspaceRoot, '.heddle');
  RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
  const secondaryWorkspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-lifecycle-secondary-'));
  const resolved = RuntimeWorkspaceService.createDescriptor({
    workspaceRoot,
    stateRoot,
    newWorkspaceRoot: secondaryWorkspaceRoot,
    workspaceStateRoot: join(secondaryWorkspaceRoot, '.heddle'),
    nextId: 'workspace-secondary',
    name: 'Secondary workspace',
    setActive: false,
  });
  const activeWorkspace = resolved.workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID);
  const secondaryWorkspace = resolved.workspaces.find((workspace) => workspace.id === 'workspace-secondary');
  if (!activeWorkspace) {
    throw new Error('expected default workspace');
  }
  if (!secondaryWorkspace) {
    throw new Error('expected secondary workspace');
  }

  const context: HeddleServerContext = {
    workspaceRoot,
    stateRoot,
    preferApiKey: false,
    activeWorkspaceId: activeWorkspace.id,
    activeWorkspace,
    workspaces: resolved.workspaces,
    runtimeHost: null,
    logger: pino({ level: 'silent' }),
  };
  const createEngineForWorkspace = (workspaceId: string) => {
    const workspace = resolved.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw new Error(`expected workspace: ${workspaceId}`);
    }

    return createWorkspaceEngine(workspace);
  };

  return {
    caller: controlPlaneRouter.createCaller(context),
    engine: createEngineForWorkspace(activeWorkspace.id),
    secondaryWorkspace,
    createEngineForWorkspace,
  };
}

function createWorkspaceEngine(workspace: WorkspaceDescriptor) {
  return createConversationEngine({
    workspaceRoot: workspace.workspaceRoot,
    stateRoot: workspace.stateRoot,
    sessionStoragePath: resolve(workspace.stateRoot, 'chat-sessions.catalog.json'),
    workspaceId: workspace.id,
    model: 'gpt-5.4',
    apiKeyPresent: true,
  });
}
