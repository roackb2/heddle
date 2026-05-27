import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import type { ChatSession } from '@/core/chat/types.js';
import type { ToolApprovalRequest, ToolApprovalUserDecision } from '@/core/approvals/index.js';
import { ControlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';
import type {
  ControlPlaneSessionRunContext,
  ControlPlaneSessionRunService,
} from '@/server/services/control-plane/session-run-service.js';

type ControllerInternals = {
  runService: ControlPlaneSessionRunService;
  runEngineTurn: (
    args: Record<string, unknown>,
    runContext: ControlPlaneSessionRunContext,
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
    const decisions: ToolApprovalUserDecision[] = [];
    const workspaceId = 'workspace-cancel';
    const sessionId = 'session-cancel-approval';
    let abortSignal: AbortSignal | undefined;

    internals.runService.start({
      address: { workspaceId, sessionId },
      onAccepted: (run) => {
        abortSignal = run.controller.signal;
      },
      execute: async () => await new Promise<never>(() => undefined),
    });
    internals.runService.storePendingApproval({ workspaceId, sessionId }, {
      approval: createApprovalRequest(),
      resolve: (decision) => {
        decisions.push(decision);
      },
    });

    expect(controller.cancelRun({ workspaceId, sessionId })).toBe(true);
    expect(abortSignal?.aborted).toBe(true);
    expect(internals.runService.getPendingApproval({ workspaceId, sessionId })).toBeUndefined();
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

    await internals.runService.startAndWait({
      address: { workspaceId, sessionId },
      execute: async (runContext) => {
        return await internals.runEngineTurn({
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
        }, runContext, async ({ shouldStop }) => {
          observedShouldStop.push(shouldStop());
          expect(controller.cancelRun({ workspaceId, sessionId })).toBe(true);
          observedShouldStop.push(shouldStop());
          return {
            outcome: 'interrupted',
            summary: 'Run interrupted by host request',
            session,
          };
        });
      },
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
