/**
 * Server heartbeat scheduler host.
 *
 * Owns process-level scheduler lifecycle for all known workspaces in the local
 * control-plane catalog. Core decides when and how tasks run; this host starts
 * and stops one core scheduler per workspace while the daemon/server process is
 * alive.
 */
import { HeartbeatSchedulerService, type HeartbeatSchedulerEvent, type HeartbeatSchedulerHandle } from '@/core/heartbeat/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';

export type HeddleHeartbeatSchedulerHostOptions = {
  workspaceRoot: string;
  stateRoot: string;
  preferApiKey?: boolean;
  pollIntervalMs?: number;
  onEvent?: (workspace: WorkspaceDescriptor, event: HeartbeatSchedulerEvent) => void;
  onError?: (workspace: WorkspaceDescriptor, error: unknown) => void;
};

type WorkspaceSchedulerHandle = {
  workspace: WorkspaceDescriptor;
  scheduler: HeartbeatSchedulerHandle;
};

export class HeddleHeartbeatSchedulerHost {
  private readonly schedulers = new Map<string, WorkspaceSchedulerHandle>();

  constructor(private readonly options: HeddleHeartbeatSchedulerHostOptions) {}

  start(): void {
    this.sync();
  }

  sync(): void {
    const context = RuntimeWorkspaceService.resolveContext({
      workspaceRoot: this.options.workspaceRoot,
      stateRoot: this.options.stateRoot,
    });
    const workspacesByKey = new Map(context.workspaces.map((workspace) => [
      HeddleHeartbeatSchedulerHost.workspaceKey(workspace),
      workspace,
    ]));

    workspacesByKey.forEach((workspace, key) => {
      if (!this.schedulers.has(key)) {
        this.schedulers.set(key, {
          workspace,
          scheduler: this.startWorkspaceScheduler(workspace),
        });
      }
    });

    [...this.schedulers.entries()]
      .filter(([key]) => !workspacesByKey.has(key))
      .forEach(([key, handle]) => {
        handle.scheduler.stop();
        this.schedulers.delete(key);
      });
  }

  stop(): void {
    this.schedulers.forEach((handle) => handle.scheduler.stop());
    this.schedulers.clear();
  }

  private startWorkspaceScheduler(workspace: WorkspaceDescriptor): HeartbeatSchedulerHandle {
    return HeartbeatSchedulerService.start({
      workspaceRoot: workspace.workspaceRoot,
      stateRoot: workspace.stateRoot,
      preferApiKey: this.options.preferApiKey,
      pollIntervalMs: this.options.pollIntervalMs,
      onEvent: (event) => this.options.onEvent?.(workspace, event),
      onError: (error) => this.options.onError?.(workspace, error),
    });
  }

  private static workspaceKey(workspace: WorkspaceDescriptor): string {
    return `${workspace.id}:${workspace.stateRoot}`;
  }
}
