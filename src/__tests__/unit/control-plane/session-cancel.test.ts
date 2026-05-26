import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ToolApprovalRequest, ToolApprovalUserDecision } from '@/core/approvals/index.js';
import { ControlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';

type ControllerInternals = {
  pendingApprovals: Map<string, {
    approval: ToolApprovalRequest;
    resolve: (decision: ToolApprovalUserDecision) => void;
  }>;
  inFlightRuns: Map<string, {
    controller: AbortController;
  }>;
  runEngineTurn: (
    args: Record<string, unknown>,
    run: (input: {
      abortSignal: AbortSignal;
      shouldStop: () => boolean;
    }) => Promise<{
      outcome: string;
      summary: string;
      session: ChatSession;
    }>,
  ) => Promise<unknown>;
};

describe('ControlPlaneChatSessionsController run cancellation', () => {
  it('aborts the active run and resolves pending approval as denied', () => {
    const controller = new ControlPlaneChatSessionsController();
    const internals = controller as unknown as ControllerInternals;
    const abortController = new AbortController();
    const decisions: ToolApprovalUserDecision[] = [];
    const workspaceId = 'workspace-cancel';
    const sessionId = 'session-cancel-approval';
    const sessionKey = `${workspaceId}:${sessionId}`;

    internals.inFlightRuns.set(sessionKey, { controller: abortController });
    internals.pendingApprovals.set(sessionKey, {
      approval: createApprovalRequest(),
      resolve: (decision) => {
        decisions.push(decision);
      },
    });

    expect(controller.cancelRun({ workspaceId, sessionId })).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(internals.pendingApprovals.has(sessionKey)).toBe(false);
    expect(decisions).toEqual([{
      type: 'deny',
      reason: 'Cancelled by user',
    }]);
  });

  it('returns false when no run is active', () => {
    const controller = new ControlPlaneChatSessionsController();

    expect(controller.cancelRun({ workspaceId: 'workspace-missing', sessionId: 'missing-session' })).toBe(false);
  });

  it('passes shouldStop from the active abort controller into the engine turn', async () => {
    const controller = new ControlPlaneChatSessionsController();
    const internals = controller as unknown as ControllerInternals;
    const workspaceId = 'workspace-should-stop';
    const sessionId = 'session-cancel-should-stop';
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-control-plane-cancel-'));
    const session = ChatSessionRecords.create({
      id: sessionId,
      name: 'Session cancel should stop',
      apiKeyPresent: true,
      model: 'gpt-5.4',
    });
    const observedShouldStop: boolean[] = [];

    await internals.runEngineTurn({
      workspaceId,
      workspaceRoot: stateRoot,
      stateRoot,
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
      sessionId,
      prompt: 'Stop this run.',
      leaseOwner: {
        ownerKind: 'daemon',
        ownerId: 'test-daemon',
        clientLabel: 'test',
      },
    }, async ({ shouldStop }) => {
      observedShouldStop.push(shouldStop());
      expect(controller.cancelRun({ workspaceId, sessionId })).toBe(true);
      observedShouldStop.push(shouldStop());
      return {
        outcome: 'interrupted',
        summary: 'Run interrupted by host request',
        session,
      };
    });

    expect(observedShouldStop).toEqual([false, true]);
    expect(controller.isRunning({ workspaceId, sessionId })).toBe(false);
  });
});

function createApprovalRequest(): ToolApprovalRequest {
  return {
    tool: 'run_shell_mutate',
    callId: 'call-1',
    input: { command: 'touch stop-test.txt' },
    requestedAt: new Date().toISOString(),
    summary: 'run shell command',
  };
}
