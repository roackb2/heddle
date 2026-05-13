/**
 * Reusable maintainer verification harness pattern for TUI behavior.
 *
 * This is intentionally not a production module. It exists so maintainers and
 * coding agents can verify host-side TUI behavior without driving the full Ink
 * UI manually.
 *
 * Current concrete coverage:
 * - new-session inheritance from the active session
 * - switching between stored sessions without clobbering model/reasoning state
 * - persisted catalog values after host-side changes
 * - runtime-provided session catalog paths are honored instead of rebuilding
 *   a default stateRoot path
 *
 * Direction:
 * - keep this script as the first concrete example of a lightweight TUI
 *   verification harness;
 * - if more host-side behaviors need this style of testing, evolve the pattern
 *   into a small shared harness instead of copying one-off scripts;
 * - do not move domain assertions here when the same behavior should already be
 *   locked by smaller unit or integration tests.
 */
import React, { useEffect } from 'react';
import { act } from 'react';
import { render, cleanup } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useChatSessions } from '../src/cli/chat/hooks/useChatSessions.js';
import { resolveNewSessionExecutionPreferences } from '../src/core/chat/engine/sessions/preferences/service.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true, writable: true });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessApi = ReturnType<typeof useChatSessions>;
let api: HarnessApi | undefined;

function Harness(props: {
  sessionCatalogFile: string;
  apiKeyPresent: boolean;
  defaultModel: string;
  workspaceRoot: string;
  stateRoot: string;
}) {
  const value = useChatSessions(props);
  useEffect(() => {
    api = value;
  }, [value]);
  return null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderHarness(args: {
  sessionCatalogFile: string;
  workspaceRoot: string;
  stateRoot: string;
}) {
  render(
    <Harness
      sessionCatalogFile={args.sessionCatalogFile}
      apiKeyPresent={true}
      defaultModel="gpt-5.4"
      workspaceRoot={args.workspaceRoot}
      stateRoot={args.stateRoot}
    />,
  );
}

async function verifySessionSwitchScenario() {
  const root = mkdtempSync(join(tmpdir(), 'heddle-session-switch-'));
  const workspaceRoot = join(root, 'workspace');
  const stateRoot = join(root, '.heddle');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const sessionCatalogFile = join(stateRoot, 'chat-sessions.json');

  renderHarness({ sessionCatalogFile, workspaceRoot, stateRoot });
  await flush();
  assert(api, 'Harness API not initialized');

  const firstSession = api.activeSession;
  assert(firstSession, 'Missing initial active session');
  const firstId = firstSession.id;

  await act(async () => {
    api!.setSessionPreferences(firstId, {
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    });
  });
  await flush();
  assert(api!.activeSession?.model === 'gpt-5.5', 'Initial session model did not persist');
  assert(api!.activeSession?.reasoningEffort === 'low', 'Initial session reasoning did not persist');

  let secondSessionId = '';
  await act(async () => {
    const next = api!.createSession(
      'Second Session',
      resolveNewSessionExecutionPreferences({
        defaultModel: 'gpt-5.4',
        inherited: {
          model: api!.activeSession?.model ?? 'gpt-5.4',
          reasoningEffort: api!.activeSession?.reasoningEffort,
        },
      }),
    );
    secondSessionId = next.id;
  });
  await flush();

  assert(api!.activeSession?.id === secondSessionId, 'New session was not activated');
  assert(api!.activeSession?.model === 'gpt-5.5', 'New session did not inherit active model');
  assert(api!.activeSession?.reasoningEffort === 'low', 'New session did not inherit active reasoning effort');

  await act(async () => {
    api!.setSessionPreferences(secondSessionId, {
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    });
  });
  await flush();
  assert(api!.activeSession?.model === 'gpt-5.4', 'Second session model update failed');
  assert(api!.activeSession?.reasoningEffort === 'medium', 'Second session reasoning update failed');

  await act(async () => {
    api!.setActiveSessionId(firstId);
  });
  await flush();
  assert(api!.activeSession?.id === firstId, 'Failed to switch back to first session');
  assert(api!.activeSession?.model === 'gpt-5.5', 'Switching back clobbered first session model');
  assert(api!.activeSession?.reasoningEffort === 'low', 'Switching back clobbered first session reasoning');

  await act(async () => {
    api!.setActiveSessionId(secondSessionId);
  });
  await flush();
  assert(api!.activeSession?.id === secondSessionId, 'Failed to switch to second session');
  assert(api!.activeSession?.model === 'gpt-5.4', 'Switching to second session clobbered second session model');
  assert(api!.activeSession?.reasoningEffort === 'medium', 'Switching to second session clobbered second session reasoning');

  const catalogPath = join(stateRoot, 'chat-sessions.catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { sessions: Array<{ id: string; model?: string; reasoningEffort?: string }> };
  const firstStored = catalog.sessions.find((entry) => entry.id === firstId);
  const secondStored = catalog.sessions.find((entry) => entry.id === secondSessionId);
  assert(firstStored?.model === 'gpt-5.5', 'Persisted first session model is wrong');
  assert(firstStored?.reasoningEffort === 'low', 'Persisted first session reasoning is wrong');
  assert(secondStored?.model === 'gpt-5.4', 'Persisted second session model is wrong');
  assert(secondStored?.reasoningEffort === 'medium', 'Persisted second session reasoning is wrong');

  cleanup();

  return {
    firstSession: firstStored,
    secondSession: secondStored,
    activeSessionId: api!.activeSession?.id,
    message: 'session-switch verification passed',
  };
}

async function verifyCustomCatalogScenario() {
  api = undefined;
  const root = mkdtempSync(join(tmpdir(), 'heddle-custom-catalog-'));
  const workspaceRoot = join(root, 'workspace');
  const stateRoot = join(root, '.heddle');
  const customStateRoot = join(root, '.heddle-embedded');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(customStateRoot, { recursive: true });

  const customCatalogFile = join(customStateRoot, 'embedded-sessions.catalog.json');
  const defaultCatalogFile = join(stateRoot, 'chat-sessions.catalog.json');

  renderHarness({ sessionCatalogFile: customCatalogFile, workspaceRoot, stateRoot });
  await flush();
  assert(api, 'Harness API not initialized for custom catalog scenario');

  await act(async () => {
    api!.createSession('Embedded Session');
  });
  await flush();

  assert(existsSync(customCatalogFile), 'Custom catalog path was not written');
  assert(!existsSync(defaultCatalogFile), 'Default catalog path should not be written for embedded runtimes');

  cleanup();

  return {
    customCatalogFile,
    defaultCatalogFile,
    message: 'custom-catalog verification passed',
  };
}

async function main() {
  const sessionSwitch = await verifySessionSwitchScenario();
  const customCatalog = await verifyCustomCatalogScenario();

  console.log(JSON.stringify({
    sessionSwitch,
    customCatalog,
  }, null, 2));

  cleanup();
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
