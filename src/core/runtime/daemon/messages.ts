/**
 * Runtime host message formatter.
 *
 * Keeps daemon-owner notices and conflict text together so host adapters do not
 * each invent slightly different wording for the same runtime-owner state.
 */
import type { ResolvedRuntimeHost } from './types.js';

export class RuntimeHostMessages {
  static formatNotice(command: string, host: ResolvedRuntimeHost): string | undefined {
    if (host.kind !== 'daemon' || host.stale) {
      return undefined;
    }

    if (command === 'chat') {
      return [
        'Heddle notice: a live daemon is attached to this workspace.',
        `daemon=http://${host.endpoint.host}:${host.endpoint.port}`,
        `workspace=${host.workspaceId}`,
        'Embedded chat still works here; avoid writing to the same session from multiple clients.',
      ].join(' ');
    }

    return [
      `Heddle notice: workspace is currently owned by a daemon for \`${command}\`.`,
      `daemon=http://${host.endpoint.host}:${host.endpoint.port}`,
      `workspace=${host.workspaceId}`,
    ].join(' ');
  }

  static embeddedCommandConflict(command: string, host: ResolvedRuntimeHost): string | undefined {
    if (host.kind !== 'daemon' || host.stale) {
      return undefined;
    }

    return [
      `Workspace ${host.workspaceId} is currently owned by a live Heddle daemon.`,
      `Refusing embedded \`${command}\` to avoid conflicting runtime owners.`,
      `daemon=http://${host.endpoint.host}:${host.endpoint.port}`,
      'Use the daemon-backed control plane, stop the daemon, or rerun with `--force-owner-conflict`.',
    ].join(' ');
  }

  static daemonStartConflict(host: ResolvedRuntimeHost): string | undefined {
    if (host.kind !== 'daemon' || host.stale) {
      return undefined;
    }

    return [
      `Workspace ${host.workspaceId} is already owned by a live Heddle daemon.`,
      'Refusing to start a second daemon.',
      `daemon=http://${host.endpoint.host}:${host.endpoint.port}`,
      'Stop the existing daemon first or rerun with `--force-owner-conflict`.',
    ].join(' ');
  }
}
