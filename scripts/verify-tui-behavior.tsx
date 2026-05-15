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
 * - TUI host state refreshes after named ConversationSessionService mutations
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
import type { ChatSession } from '../src/core/chat/types.js';

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

function requireApi(): HarnessApi {
  assert(api, 'Harness API not initialized');
  return api;
}

function getActiveSession(message = 'Missing active session'): ChatSession {
  const session = requireApi().activeSession;
  assert(session, message);
  return session;
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
  api = undefined;
  const root = mkdtempSync(join(tmpdir(), 'heddle-session-switch-'));
  const workspaceRoot = join(root, 'workspace');
  const stateRoot = join(root, '.heddle');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const sessionCatalogFile = join(stateRoot, 'chat-sessions.json');

  renderHarness({ sessionCatalogFile, workspaceRoot, stateRoot });
  await flush();

  const firstSession = getActiveSession('Missing initial active session');
  const firstId = firstSession.id;

  await act(async () => {
    api!.setSessionPreferences(firstId, {
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    });
  });
  await flush();
  assert(getActiveSession().model === 'gpt-5.5', 'Initial session model did not persist');
  assert(getActiveSession().reasoningEffort === 'low', 'Initial session reasoning did not persist');

  let secondSessionId = '';
  await act(async () => {
    const next = api!.createSession(
      'Second Session',
      resolveNewSessionExecutionPreferences({
        defaultModel: 'gpt-5.4',
        inherited: {
          model: getActiveSession().model ?? 'gpt-5.4',
          reasoningEffort: getActiveSession().reasoningEffort,
        },
      }),
    );
    secondSessionId = next.id;
  });
  await flush();

  assert(getActiveSession().id === secondSessionId, 'New session was not activated');
  assert(getActiveSession().model === 'gpt-5.5', 'New session did not inherit active model');
  assert(getActiveSession().reasoningEffort === 'low', 'New session did not inherit active reasoning effort');

  await act(async () => {
    api!.setSessionPreferences(secondSessionId, {
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    });
  });
  await flush();
  assert(getActiveSession().model === 'gpt-5.4', 'Second session model update failed');
  assert(getActiveSession().reasoningEffort === 'medium', 'Second session reasoning update failed');

  await act(async () => {
    api!.setActiveSessionId(firstId);
  });
  await flush();
  assert(getActiveSession().id === firstId, 'Failed to switch back to first session');
  assert(getActiveSession().model === 'gpt-5.5', 'Switching back clobbered first session model');
  assert(getActiveSession().reasoningEffort === 'low', 'Switching back clobbered first session reasoning');

  await act(async () => {
    api!.setActiveSessionId(secondSessionId);
  });
  await flush();
  assert(getActiveSession().id === secondSessionId, 'Failed to switch to second session');
  assert(getActiveSession().model === 'gpt-5.4', 'Switching to second session clobbered second session model');
  assert(getActiveSession().reasoningEffort === 'medium', 'Switching to second session clobbered second session reasoning');

  const catalogPath = join(stateRoot, 'chat-sessions.catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { sessions: Array<{ id: string; model?: string; reasoningEffort?: string }> };
  const firstStored = catalog.sessions.find((entry) => entry.id === firstId);
  const secondStored = catalog.sessions.find((entry) => entry.id === secondSessionId);
  assert(firstStored?.model === 'gpt-5.5', 'Persisted first session model is wrong');
  assert(firstStored?.reasoningEffort === 'low', 'Persisted first session reasoning is wrong');
  assert(secondStored?.model === 'gpt-5.4', 'Persisted second session model is wrong');
  assert(secondStored?.reasoningEffort === 'medium', 'Persisted second session reasoning is wrong');

  const activeSessionId = getActiveSession().id;
  cleanup();

  return {
    firstSession: firstStored,
    secondSession: secondStored,
    activeSessionId,
    message: 'session-switch verification passed',
  };
}

async function verifySessionBoundaryScenario() {
  api = undefined;
  const root = mkdtempSync(join(tmpdir(), 'heddle-session-boundary-'));
  const workspaceRoot = join(root, 'workspace');
  const stateRoot = join(root, '.heddle');
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const sessionCatalogFile = join(stateRoot, 'chat-sessions.catalog.json');

  renderHarness({ sessionCatalogFile, workspaceRoot, stateRoot });
  await flush();

  const sessionId = getActiveSession('Missing initial active session for session boundary scenario').id;

  await act(async () => {
    api!.sessionService.appendMessages(sessionId, [
      { id: 'verify-user-message', role: 'user', text: 'Verify visible user append' },
      { id: 'verify-assistant-message', role: 'assistant', text: 'Verify visible assistant append' },
    ]);
    api!.sessionService.setLastContinuePrompt(sessionId, 'continue this verification');
    api!.sessionService.acquireLease(sessionId, {
      ownerKind: 'tui',
      ownerId: 'verify-session-boundary',
      clientLabel: 'verification harness',
    });
    api!.refreshSessions();
  });
  await flush();

  assert(getActiveSession().messages.at(-2)?.text === 'Verify visible user append', 'Service append did not refresh visible user message');
  assert(getActiveSession().messages.at(-1)?.text === 'Verify visible assistant append', 'Service append did not refresh visible assistant message');
  assert(getActiveSession().lastContinuePrompt === 'continue this verification', 'Continue prompt did not refresh through service');
  assert(getActiveSession().lease?.ownerId === 'verify-session-boundary', 'Lease acquire did not refresh through service');

  await act(async () => {
    api!.sessionService.markCompactionRunning(sessionId, {
      sourceHistory: [
        { role: 'user', content: 'Verbose prompt before compaction' },
        { role: 'assistant', content: 'Verbose answer before compaction' },
      ],
      archivePath: join(stateRoot, 'archives', 'verify.jsonl'),
    });
    api!.refreshSessions();
  });
  await flush();

  assert(getActiveSession().context?.compactionStatus === 'running', 'Compaction running state did not refresh through service');
  assert(getActiveSession().context?.lastArchivePath?.endsWith('verify.jsonl'), 'Compaction archive path was not stored');

  await act(async () => {
    api!.sessionService.applyCompactionResult(sessionId, {
      history: [
        { role: 'user', content: 'Compact prompt' },
        { role: 'assistant', content: 'Compact answer' },
      ],
      context: { estimatedHistoryTokens: 2, compactionStatus: 'idle' },
      archives: [],
    });
    api!.sessionService.releaseLease(sessionId, { ownerId: 'verify-session-boundary' });
    api!.refreshSessions();
  });
  await flush();

  assert(getActiveSession().messages.at(-2)?.text === 'Compact prompt', 'Compaction result did not rebuild visible user message');
  assert(getActiveSession().messages.at(-1)?.text === 'Compact answer', 'Compaction result did not rebuild visible assistant message');
  assert(getActiveSession().context?.compactionStatus === 'idle', 'Compaction result did not refresh idle status');
  assert(getActiveSession().lease === undefined, 'Lease release did not refresh through service');

  const messages = getActiveSession().messages.map((message) => `${message.role}:${message.text}`);
  const compactionStatus = getActiveSession().context?.compactionStatus;
  cleanup();

  return {
    sessionId,
    messages,
    compactionStatus,
    message: 'session-boundary verification passed',
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
  requireApi();

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
  const sessionBoundary = await verifySessionBoundaryScenario();
  const customCatalog = await verifyCustomCatalogScenario();

  console.log(JSON.stringify({
    sessionSwitch,
    sessionBoundary,
    customCatalog,
  }, null, 2));

  cleanup();
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
