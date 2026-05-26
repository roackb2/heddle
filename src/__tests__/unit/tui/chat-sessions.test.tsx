/** @vitest-environment jsdom */

import React, { useEffect } from 'react';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatSessions } from '../../../cli/chat/hooks/useChatSessions.js';
import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';

type HookSnapshot = ReturnType<typeof useChatSessions>;

function HookHarness(args: {
  sessionCatalogFile: string;
  workspaceRoot: string;
  stateRoot: string;
  controlPlaneClient?: ControlPlaneProxyClient;
  onReady: (value: HookSnapshot) => void;
}) {
  const value = useChatSessions({
    sessionCatalogFile: args.sessionCatalogFile,
    apiKeyPresent: true,
    defaultModel: 'gpt-5.4',
    workspaceRoot: args.workspaceRoot,
    stateRoot: args.stateRoot,
    controlPlaneClient: args.controlPlaneClient,
  });

  useEffect(() => {
    args.onReady(value);
  }, [args, value]);

  return null;
}

describe('useChatSessions', () => {
  it('uses the runtime-provided session catalog path instead of rebuilding the default path from stateRoot', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-chat-sessions-hook-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const customStateRoot = join(workspaceRoot, '.heddle-embedded');
    const customCatalogFile = join(customStateRoot, 'custom-sessions.catalog.json');
    const defaultCatalogFile = join(stateRoot, 'chat-sessions.catalog.json');

    let latest: HookSnapshot | undefined;

    render(
      <HookHarness
        sessionCatalogFile={customCatalogFile}
        workspaceRoot={workspaceRoot}
        stateRoot={stateRoot}
        onReady={(value) => {
          latest = value;
        }}
      />,
    );

    expect(latest).toBeDefined();

    await act(async () => {
      await latest?.createSession('Embedded session');
    });

    expect(existsSync(customCatalogFile)).toBe(true);
    expect(existsSync(defaultCatalogFile)).toBe(false);
    expect(latest?.sessions.some((session) => session.name === 'Embedded session')).toBe(true);
  });

  it('routes lifecycle mutations through the control-plane client when one is available', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-chat-sessions-api-hook-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const customCatalogFile = join(stateRoot, 'chat-sessions.catalog.json');
    const controlPlaneClient = {
      controlPlane: {
        sessionCreate: {
          mutate: vi.fn(async () => ({ id: 'session-1' })),
        },
        sessionRename: {
          mutate: vi.fn(async () => ({ id: 'session-1' })),
        },
        sessionDelete: {
          mutate: vi.fn(async () => ({ deleted: true })),
        },
        sessionReset: {
          mutate: vi.fn(async () => ({ id: 'session-1' })),
        },
        sessionSettingsUpdate: {
          mutate: vi.fn(async () => ({ id: 'session-1' })),
        },
      },
    } as unknown as ControlPlaneProxyClient;
    let latest: HookSnapshot | undefined;

    render(
      <HookHarness
        sessionCatalogFile={customCatalogFile}
        workspaceRoot={workspaceRoot}
        stateRoot={stateRoot}
        controlPlaneClient={controlPlaneClient}
        onReady={(value) => {
          latest = value;
        }}
      />,
    );

    expect(latest).toBeDefined();

    await act(async () => {
      await latest?.createSession('Remote session', { model: 'gpt-5.4', reasoningEffort: 'high' });
    });
    await act(async () => {
      await latest?.renameSession('Renamed remotely');
    });
    await act(async () => {
      await latest?.removeSession('session-1');
    });
    await act(async () => {
      await latest?.resetSession('session-1');
    });
    await act(async () => {
      await latest?.setSessionPreferences('session-1', { model: 'gpt-5.4-mini' });
    });

    expect(controlPlaneClient.controlPlane.sessionCreate.mutate).toHaveBeenCalledWith({
      name: 'Remote session',
      apiKeyPresent: true,
      workspaceId: 'default',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });
    expect(controlPlaneClient.controlPlane.sessionRename.mutate).toHaveBeenCalledWith({
      id: 'session-1',
      workspaceId: 'default',
      name: 'Renamed remotely',
    });
    expect(controlPlaneClient.controlPlane.sessionDelete.mutate).toHaveBeenCalledWith({
      id: 'session-1',
      workspaceId: 'default',
    });
    expect(controlPlaneClient.controlPlane.sessionReset.mutate).toHaveBeenCalledWith({
      id: 'session-1',
      workspaceId: 'default',
    });
    expect(controlPlaneClient.controlPlane.sessionSettingsUpdate.mutate).toHaveBeenCalledWith({
      id: 'session-1',
      workspaceId: 'default',
      model: 'gpt-5.4-mini',
      reasoningEffort: undefined,
    });
  });
});
