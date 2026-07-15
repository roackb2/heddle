import type { EventEmitter } from 'node:events';
import isString from 'lodash/isString.js';
import pick from 'lodash/pick.js';
import pickBy from 'lodash/pickBy.js';
import {
  type ConversationRunContext,
  type ConversationRunService,
} from '@/core/chat/runs/index.js';
import type {
  ControlPlaneSessionRunEventEnvelope,
  ControlPlaneSessionRunReference,
  ControlPlaneSessionRunResult,
} from '@/server/control-plane-types.js';
import { ControlPlaneChatSessionEventsController } from './chat-session-events.js';

export type ControlPlaneSessionAddress = {
  workspaceId: string;
  sessionId: string;
};

type ControlPlaneRunLifecycleCallbacks = {
  onAccepted?: (run: ConversationRunContext) => void | Promise<void>;
  onSettled?: (run: ConversationRunContext) => void | Promise<void>;
};

type ControlPlaneChatSessionRunStreamControllerOptions = {
  eventBus: EventEmitter;
  runService: ConversationRunService<ControlPlaneSessionAddress>;
};

/**
 * Adapts core conversation runs to the control-plane transport contract.
 *
 * Core owns run execution, replay, and terminal ordering. This adapter owns
 * public result projection plus lifecycle fanout for clients that first learn
 * run identity from a session-scoped subscription.
 */
export class ControlPlaneChatSessionRunStreamController {
  constructor(private readonly options: ControlPlaneChatSessionRunStreamControllerOptions) {}

  resolveAddress(address: ControlPlaneSessionAddress): ControlPlaneSessionAddress {
    return pick(address, ['workspaceId', 'sessionId']);
  }

  readState(address: ControlPlaneSessionAddress) {
    const sessionAddress = this.resolveAddress(address);
    const activeRun = this.options.runService.getActiveRun(sessionAddress);
    return {
      running: Boolean(activeRun),
      activeRun: activeRun ? this.projectRunReference(activeRun) : null,
      pendingApproval: this.options.runService.getPendingApproval(sessionAddress) ?? null,
    };
  }

  async *subscribe(args: ControlPlaneSessionAddress & {
    runId: string;
    afterSequence?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<ControlPlaneSessionRunEventEnvelope> {
    const events = this.options.runService.subscribe<unknown>({
      address: this.resolveAddress(args),
      runId: args.runId,
      afterSequence: args.afterSequence,
      signal: args.signal,
    });
    for await (const event of events) {
      if (event.kind === 'result') {
        yield {
          ...event,
          result: this.projectRunResult(event.result),
        };
        continue;
      }
      yield event;
    }
  }

  createLifecycle(
    address: ControlPlaneSessionAddress,
    callbacks: ControlPlaneRunLifecycleCallbacks = {},
  ) {
    const sessionAddress = this.resolveAddress(address);
    const publisher = ControlPlaneChatSessionEventsController.createSessionEventPublisher({
      eventBus: this.options.eventBus,
      ...sessionAddress,
    });
    let terminalObserver: Promise<void> | undefined;

    return {
      onAccepted: async (run: ConversationRunContext) => {
        publisher.publishRunUpdated(this.projectRunReference(run), 'started');
        terminalObserver = this.publishWorkspaceRunTerminal(sessionAddress, run.runId, publisher);
        void terminalObserver.catch(() => undefined);
        await callbacks.onAccepted?.(run);
      },
      onSettled: async (run: ConversationRunContext) => {
        try {
          await terminalObserver;
        } finally {
          publisher.publishRunUpdated(this.projectRunReference(run), 'settled');
          await callbacks.onSettled?.(run);
        }
      },
    };
  }

  private async publishWorkspaceRunTerminal(
    address: ControlPlaneSessionAddress,
    runId: string,
    publisher: ReturnType<typeof ControlPlaneChatSessionEventsController.createSessionEventPublisher>,
  ): Promise<void> {
    for await (const item of this.subscribe({ ...address, runId })) {
      if (item.kind !== 'activity') {
        publisher.publishWorkspaceRunTerminal(item);
        return;
      }
    }
  }

  private projectRunReference(
    run: Pick<ConversationRunContext, 'runId' | 'acceptedAt'>,
  ): ControlPlaneSessionRunReference {
    return pick(run, ['runId', 'acceptedAt']);
  }

  private projectRunResult(result: unknown): ControlPlaneSessionRunResult {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return {};
    }

    return pickBy(
      pick(result as Record<string, unknown>, ['outcome', 'summary']),
      isString,
    ) as ControlPlaneSessionRunResult;
  }
}
