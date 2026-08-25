import type {
  VerifiedExecutionHostMcpCapability,
  VerifiedExecutionIdentity,
} from '../types.js';
import {
  RuntimeBusyError,
  RuntimeDeadlineError,
  RuntimeDuplicateInvocationError,
} from './errors.js';
import {
  RuntimeScopeBindingService,
  type BoundRuntimeScope,
} from './scope-binding.js';
import {
  RuntimeSessionStatusService,
  type RuntimeSessionStatusSnapshot,
} from './status.js';
import type {
  RuntimeExecutionHandle,
  RuntimeExecutionInput,
  RuntimeInvocationHandle,
  RuntimeInvocationRequest,
  RuntimeSessionConfig,
  RuntimeWorkflowExecutors,
} from './types.js';

const RECENT_INVOCATION_LIMIT = 128;

type ActiveInvocation = {
  invocationId: string;
  run: RuntimeExecutionHandle;
  controller: AbortController;
  deadlineTimer: ReturnType<typeof setTimeout>;
  removeCallerAbortListener: () => void;
};

type StartingInvocation = {
  controller: AbortController;
  promise: Promise<RuntimeExecutionHandle>;
};

/** Coordinates one process-bound Runtime session without owning product data. */
export class RuntimeSessionService {
  private active?: ActiveInvocation;
  private starting?: StartingInvocation;
  private readonly recentCompletedInvocationIds = new Set<string>();
  private readonly recentCompletedInvocationOrder: string[] = [];
  private readonly config: RuntimeSessionConfig;
  private readonly executors: RuntimeWorkflowExecutors;
  private readonly binding: RuntimeScopeBindingService;
  private readonly status: RuntimeSessionStatusService;
  private readonly now: () => Date;

  constructor(options: {
    config: RuntimeSessionConfig;
    executors: RuntimeWorkflowExecutors;
    binding?: RuntimeScopeBindingService;
    status?: RuntimeSessionStatusService;
    now?: () => Date;
  }) {
    if (
      !Number.isSafeInteger(options.config.maxInvocationMs)
      || options.config.maxInvocationMs <= 0
    ) {
      throw new Error('maxInvocationMs must be a positive safe integer.');
    }
    this.config = options.config;
    this.executors = options.executors;
    this.binding = options.binding ?? new RuntimeScopeBindingService();
    this.now = options.now ?? (() => new Date());
    this.status = options.status ?? new RuntimeSessionStatusService(this.now);
  }

  readStatus(): RuntimeSessionStatusSnapshot {
    return this.status.read();
  }

  async start(input: {
    identity: VerifiedExecutionIdentity;
    invocation: RuntimeInvocationRequest;
    modelApiKey: string;
    mcpCapability?: VerifiedExecutionHostMcpCapability;
    callerSignal: AbortSignal;
  }): Promise<RuntimeInvocationHandle> {
    const deadline = this.resolveDeadline(input.invocation.deadlineAt);
    const binding = this.binding.bind({
      runtimeSessionId: input.identity.runtimeSessionId,
      ...input.identity.scope,
    });

    if (this.active || this.starting) {
      throw new RuntimeBusyError(
        'This runtime session already has an active invocation.',
      );
    }
    if (this.recentCompletedInvocationIds.has(input.identity.invocationId)) {
      throw new RuntimeDuplicateInvocationError(
        'This recent invocation identifier already completed in the current runtime process.',
      );
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.callerSignal.reason);
    input.callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    if (input.callerSignal.aborted) {
      abortFromCaller();
    }

    const deadlineTimer = setTimeout(
      () => controller.abort(
        new RuntimeDeadlineError('The runtime invocation deadline elapsed.'),
      ),
      deadline.getTime() - this.now().getTime(),
    );
    deadlineTimer.unref();

    this.status.markExecuting();
    const executionInput = {
      scopeKey: binding.scopeKey,
      executionSessionId: binding.executionSessionId,
      request: input.invocation,
      modelApiKey: input.modelApiKey,
      mcpCapability: input.mcpCapability,
      abortSignal: controller.signal,
    } satisfies RuntimeExecutionInput;
    const startPromise = Promise.resolve().then(
      () => this.startExecution(executionInput),
    );
    const starting: StartingInvocation = {
      controller,
      promise: startPromise,
    };
    this.starting = starting;

    let run: RuntimeExecutionHandle;
    try {
      run = await startPromise;
    } catch (error) {
      clearTimeout(deadlineTimer);
      input.callerSignal.removeEventListener('abort', abortFromCaller);
      this.status.markIdle();
      throw error;
    } finally {
      if (this.starting === starting) {
        this.starting = undefined;
      }
    }

    const active: ActiveInvocation = {
      invocationId: input.identity.invocationId,
      run,
      controller,
      deadlineTimer,
      removeCallerAbortListener: () =>
        input.callerSignal.removeEventListener('abort', abortFromCaller),
    };
    this.active = active;
    controller.signal.addEventListener('abort', () => run.cancel(), {
      once: true,
    });
    if (controller.signal.aborted) {
      run.cancel();
    }

    const result = run.result.finally(() => this.settle(active));
    result.catch(() => undefined);

    return {
      runId: run.runId,
      acceptedAt: this.now().toISOString(),
      // The execution signal cancels the agent, but the event subscription
      // remains open for the executor's truthful cancelled terminal.
      events: () => run.events(),
      cancel: () => {
        const wasActive = !controller.signal.aborted;
        controller.abort();
        return wasActive;
      },
      result,
    };
  }

  async shutdown(): Promise<void> {
    const starting = this.starting;
    if (starting) {
      starting.controller.abort(new Error('Runtime is shutting down.'));
      const run = await starting.promise.catch(() => undefined);
      if (run) {
        run.cancel();
        await run.result.catch(() => undefined);
      }
    }

    const active = this.active;
    if (!active) {
      return;
    }
    active.controller.abort(new Error('Runtime is shutting down.'));
    active.run.cancel();
    await active.run.result.catch(() => undefined);
  }

  boundScope(): BoundRuntimeScope | undefined {
    return this.binding.current();
  }

  private resolveDeadline(deadlineAt?: string): Date {
    const now = this.now();
    const maximum = new Date(now.getTime() + this.config.maxInvocationMs);
    if (!deadlineAt) {
      return maximum;
    }

    const requested = new Date(deadlineAt);
    if (requested.getTime() <= now.getTime()) {
      throw new RuntimeDeadlineError(
        'The runtime invocation deadline has already elapsed.',
      );
    }
    return requested.getTime() < maximum.getTime() ? requested : maximum;
  }

  private settle(active: ActiveInvocation): void {
    if (this.active !== active) {
      return;
    }
    clearTimeout(active.deadlineTimer);
    active.removeCallerAbortListener();
    this.active = undefined;
    this.rememberCompletedInvocation(active.invocationId);
    this.status.markIdle();
  }

  private rememberCompletedInvocation(invocationId: string): void {
    this.recentCompletedInvocationIds.add(invocationId);
    this.recentCompletedInvocationOrder.push(invocationId);
    if (this.recentCompletedInvocationOrder.length <= RECENT_INVOCATION_LIMIT) {
      return;
    }
    const oldest = this.recentCompletedInvocationOrder.shift();
    if (oldest) {
      this.recentCompletedInvocationIds.delete(oldest);
    }
  }

  private startExecution(
    input: RuntimeExecutionInput,
  ): Promise<RuntimeExecutionHandle> {
    if (input.request.kind === 'conversation-turn') {
      return this.executors.conversationTurn.start({
        ...input,
        request: input.request,
      });
    }
    return this.executors.heartbeatTask.start({
      ...input,
      request: input.request,
    });
  }
}
