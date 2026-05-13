/** @vitest-environment jsdom */

import React, { useEffect } from 'react';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChatSessions } from '../../../cli/chat/hooks/useChatSessions.js';

type HookSnapshot = ReturnType<typeof useChatSessions>;

function HookHarness(args: {
  sessionCatalogFile: string;
  workspaceRoot: string;
  stateRoot: string;
  onReady: (value: HookSnapshot) => void;
}) {
  const value = useChatSessions({
    sessionCatalogFile: args.sessionCatalogFile,
    apiKeyPresent: true,
    defaultModel: 'gpt-5.4',
    workspaceRoot: args.workspaceRoot,
    stateRoot: args.stateRoot,
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
      latest?.createSession('Embedded session');
    });

    expect(existsSync(customCatalogFile)).toBe(true);
    expect(existsSync(defaultCatalogFile)).toBe(false);
    expect(latest?.sessions.some((session) => session.name === 'Embedded session')).toBe(true);
  });
});
