/** @vitest-environment jsdom */

import React, { useEffect } from 'react';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatSessions } from '../../../cli/chat/hooks/useChatSessions.js';
import type { ControlPlaneProxyClient } from '@/client-shared/api/proxy.js';
import { FileConversationSessionService } from '@/core/chat/engine/sessions/service.js';

type HookSnapshot = ReturnType<typeof useChatSessions>;

function HookHarness(args: {
  sessionCatalogFile: string;
  workspaceRoot: string;
  stateRoot: string;
  controlPlaneClient: ControlPlaneProxyClient;
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
    const controlPlaneClient = createSessionLifecycleClient({
      sessionCatalogFile: customCatalogFile,
      workspaceRoot,
      stateRoot,
    });

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
    const controlPlaneClient = createSessionLifecycleClient({
      sessionCatalogFile: customCatalogFile,
      workspaceRoot,
      stateRoot,
    });
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

function createSessionLifecycleClient(args: {
  sessionCatalogFile: string;
  workspaceRoot: string;
  stateRoot: string;
}): ControlPlaneProxyClient {
  const sessionService = new FileConversationSessionService({
    workspaceRoot: args.workspaceRoot,
    stateRoot: args.stateRoot,
    sessionStoragePath: args.sessionCatalogFile,
    model: 'gpt-5.4',
    apiKeyPresent: true,
    workspaceId: 'default',
  });

  return {
    controlPlane: {
      sessionCreate: {
        mutate: vi.fn(async (input) =>
          sessionService.create({
            id: 'session-1',
            name: input?.name,
            apiKeyPresent: input?.apiKeyPresent,
            model: input?.model,
            reasoningEffort: input?.reasoningEffort ?? undefined,
            workspaceId: input?.workspaceId,
          }),
        ),
      },
      sessionRename: {
        mutate: vi.fn(async (input) => sessionService.rename(input.id, input.name)),
      },
      sessionDelete: {
        mutate: vi.fn(async (input) => ({ deleted: sessionService.delete(input.id) })),
      },
      sessionReset: {
        mutate: vi.fn(async (input) => sessionService.resetConversation(input.id, { apiKeyPresent: true })),
      },
      sessionSettingsUpdate: {
        mutate: vi.fn(async (input) => sessionService.updateSettings(input.id, {
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          driftEnabled: input.driftEnabled,
        })),
      },
    },
  } as unknown as ControlPlaneProxyClient;
}
