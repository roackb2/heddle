import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ChatMessage } from '../llm/types.js';
import type { ChatArchiveRecord, ChatContextStats, ChatSession, ChatSessionLease, ConversationLine, TurnSummary } from './types.js';
import { truncate } from '../utils/text.js';

type ChatSessionCatalogEntry = {
  id: string;
  name: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  driftEnabled?: boolean;
  lastContinuePrompt?: string;
  context?: ChatContextStats;
  archives?: ChatArchiveRecord[];
  lease?: ChatSessionLease;
};

type ChatSessionCatalog = {
  version: 1;
  sessions: ChatSessionCatalogEntry[];
};

export function createInitialMessages(apiKeyPresent: boolean): ConversationLine[] {
  return [
    {
      id: 'intro',
      role: 'assistant',
      text:
        'Heddle conversational mode.\n\nAsk a question about this workspace.\nEach turn runs the current agent loop and carries the transcript into the next turn.\nUse !<command> to run a shell command directly in chat.',
    },
    ...(!apiKeyPresent ?
      [{
        id: 'missing-key',
        role: 'assistant' as const,
        text:
          'No provider credential detected. For OpenAI, run `heddle auth login openai` or set OPENAI_API_KEY. For Anthropic, set ANTHROPIC_API_KEY. Dev fallback conventions also work: PERSONAL_OPENAI_API_KEY and PERSONAL_ANTHROPIC_API_KEY.',
      }]
    : []),
  ];
}

export function createChatSession(options: {
  id: string;
  name: string;
  apiKeyPresent: boolean;
  model?: string;
  workspaceId?: string;
}): ChatSession {
  const now = new Date().toISOString();
  return {
    id: options.id,
    name: options.name,
    workspaceId: options.workspaceId,
    history: [],
    messages: createInitialMessages(options.apiKeyPresent),
    turns: [],
    createdAt: now,
    updatedAt: now,
    model: options.model,
    driftEnabled: false,
    lastContinuePrompt: undefined,
    context: undefined,
    archives: [],
    lease: undefined,
  };
}

export function touchSession(session: ChatSession): ChatSession {
  return { ...session, updatedAt: new Date().toISOString() };
}

export function summarizeSession(session: ChatSession): string {
  const latestTurn = session.turns[session.turns.length - 1];
  const latestPrompt = latestTurn ? truncate(latestTurn.prompt, 44) : 'no turns yet';
  return `${session.turns.length} turns • ${latestPrompt}`;
}

export function isGenericSessionName(name: string): boolean {
  return /^Session \d+$/.test(name.trim());
}

export function loadChatSessions(sessionsPath: string, apiKeyPresent: boolean): ChatSession[] {
  const resolved = loadChatSessionsFromCurrentStorage(sessionsPath, apiKeyPresent);
  if (resolved.length > 0) {
    return resolved;
  }

  const migrated = migrateLegacyChatSessions(sessionsPath, apiKeyPresent);
  if (migrated.length > 0) {
    return migrated;
  }

  return [
    createChatSession({
      id: 'session-1',
      name: 'Session 1',
      apiKeyPresent,
    }),
  ];
}

export function readChatSessionCatalog(sessionsPath: string): ChatSessionCatalogEntry[] {
  const paths = deriveSessionStoragePaths(sessionsPath);
  const catalog = readCatalog(paths.catalogPath);
  return catalog?.sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) ?? [];
}

export function readChatSession(sessionsPath: string, sessionId: string, apiKeyPresent: boolean): ChatSession | undefined {
  const paths = deriveSessionStoragePaths(sessionsPath);
  const catalog = readCatalog(paths.catalogPath);
  const entry = catalog?.sessions.find((candidate) => candidate.id === sessionId);
  if (!entry) {
    return undefined;
  }

  return readSessionFile(paths.sessionsDir, entry, apiKeyPresent)[0];
}

export function migrateLegacyChatSessions(sessionsPath: string, apiKeyPresent: boolean): ChatSession[] {
  const legacySessions = loadLegacyChatSessions(sessionsPath, apiKeyPresent);
  if (legacySessions.length === 0) {
    return [];
  }

  saveChatSessions(sessionsPath, legacySessions);
  return legacySessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function saveChatSessions(sessionsPath: string, sessions: ChatSession[]) {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  const paths = deriveSessionStoragePaths(sessionsPath);
  mkdirSync(paths.sessionsDir, { recursive: true });

  const sorted = dedupeSessionsById(sessions).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const previousCatalog = readCatalog(paths.catalogPath);
  const previousSessionBodies = new Map<string, string>();
  for (const entry of previousCatalog?.sessions ?? []) {
    const body = readSessionFileContents(paths.sessionsDir, entry.id);
    if (body !== undefined) {
      previousSessionBodies.set(entry.id, body);
    }
  }

  for (const session of sorted) {
    writeSessionFileIfChanged(paths.sessionsDir, session, previousSessionBodies.get(session.id));
  }

  const catalog: ChatSessionCatalog = {
    version: 1,
    sessions: sorted.map((session) => projectCatalogEntry(session)),
  };

  writeCatalogIfChanged(paths.catalogPath, catalog, previousCatalog);
  removeOrphanedSessionFiles(paths.sessionsDir, catalog.sessions.map((session) => session.id));
}

export function deriveSessionStoragePaths(storagePath: string) {
  const stateDir = dirname(storagePath);
  const legacyPath = storagePath.endsWith('chat-sessions.catalog.json') ? join(stateDir, 'chat-sessions.json') : storagePath;
  return {
    legacyPath,
    catalogPath: join(stateDir, 'chat-sessions.catalog.json'),
    sessionsDir: join(stateDir, 'chat-sessions'),
  };
}

function loadChatSessionsFromCurrentStorage(sessionsPath: string, apiKeyPresent: boolean): ChatSession[] {
  const paths = deriveSessionStoragePaths(sessionsPath);
  return loadSessionsFromCatalog(paths, apiKeyPresent);
}

function loadSessionsFromCatalog(paths: ReturnType<typeof deriveSessionStoragePaths>, apiKeyPresent: boolean): ChatSession[] {
  if (!existsSync(paths.catalogPath)) {
    return [];
  }

  try {
    const raw = JSON.parse(readFileSync(paths.catalogPath, 'utf8')) as unknown;
    const catalog = parseCatalog(raw);
    if (!catalog) {
      return [];
    }

    const sessions = catalog.sessions.flatMap((entry) => readSessionFile(paths.sessionsDir, entry, apiKeyPresent));
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch (error) {
    process.stderr.write(
      `Failed to load chat session catalog from ${paths.catalogPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return [];
  }
}

function loadLegacyChatSessions(sessionsPath: string, apiKeyPresent: boolean): ChatSession[] {
  try {
    if (!existsSync(sessionsPath)) {
      return [];
    }

    const raw = readFileSync(sessionsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Expected session array');
    }

    return parsed
      .flatMap((value) => parseSavedSession(value, apiKeyPresent))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch (error) {
    process.stderr.write(
      `Failed to load chat sessions from ${sessionsPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return [];
  }
}

function parseCatalog(value: unknown): ChatSessionCatalog | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Partial<ChatSessionCatalog> & { sessions?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.sessions)) {
    return undefined;
  }

  const sessions = candidate.sessions.flatMap(parseCatalogEntry);
  return { version: 1, sessions };
}

function parseCatalogEntry(value: unknown): ChatSessionCatalogEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = value as Partial<ChatSessionCatalogEntry>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return [];
  }

  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;

  return [{
    id: candidate.id,
    name: candidate.name,
    workspaceId: typeof candidate.workspaceId === 'string' ? candidate.workspaceId : undefined,
    createdAt,
    updatedAt,
    model: typeof candidate.model === 'string' ? candidate.model : undefined,
    driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : false,
    lastContinuePrompt: typeof candidate.lastContinuePrompt === 'string' ? candidate.lastContinuePrompt : undefined,
    context: isChatContextStats(candidate.context) ? candidate.context : undefined,
    archives: Array.isArray(candidate.archives) ? candidate.archives.flatMap(parseArchiveRecord) : undefined,
    lease: parseLease(candidate.lease),
  }];
}

function projectCatalogEntry(session: ChatSession): ChatSessionCatalogEntry {
  return {
    id: session.id,
    name: session.name,
    workspaceId: session.workspaceId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    model: session.model,
    driftEnabled: session.driftEnabled,
    lastContinuePrompt: session.lastContinuePrompt,
    context: session.context,
    archives: session.archives,
    lease: session.lease,
  };
}

function readSessionFile(
  sessionsDir: string,
  entry: ChatSessionCatalogEntry,
  apiKeyPresent: boolean,
): ChatSession[] {
  const path = sessionFilePath(sessionsDir, entry.id);
  if (!existsSync(path)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const payload = readObjectRecord(parsed);
    if (!payload) {
      return [];
    }

    return [{
      id: entry.id,
      name: entry.name,
      workspaceId: entry.workspaceId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      model: entry.model,
      driftEnabled: entry.driftEnabled,
      lastContinuePrompt: entry.lastContinuePrompt,
      context: entry.context,
      archives: entry.archives,
      lease: entry.lease,
      history: Array.isArray(payload.history) ? payload.history as ChatMessage[] : [],
      messages:
        Array.isArray(payload.messages) && payload.messages.length > 0 ?
          payload.messages.filter(isConversationLine)
        : createInitialMessages(apiKeyPresent),
      turns: Array.isArray(payload.turns) ? payload.turns.filter(isTurnSummary) : [],
    }];
  } catch (error) {
    process.stderr.write(
      `Failed to load chat session file ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return [];
  }
}

function writeSessionFileIfChanged(sessionsDir: string, session: ChatSession, previousContent?: string) {
  const path = sessionFilePath(sessionsDir, session.id);
  const nextContent = serializeSessionBody(session);
  if (previousContent === nextContent) {
    return;
  }

  writeFileSync(path, nextContent);
}

function writeCatalogIfChanged(
  catalogPath: string,
  catalog: ChatSessionCatalog,
  previousCatalog?: ChatSessionCatalog,
) {
  const nextContent = `${JSON.stringify(catalog, null, 2)}\n`;
  const previousContent = previousCatalog ? `${JSON.stringify(previousCatalog, null, 2)}\n` : undefined;
  if (previousContent === nextContent) {
    return;
  }

  writeFileSync(catalogPath, nextContent);
}

function serializeSessionBody(session: ChatSession): string {
  return `${JSON.stringify({
    id: session.id,
    workspaceId: session.workspaceId,
    history: session.history,
    messages: session.messages,
    turns: session.turns,
    archives: session.archives,
    lease: session.lease,
  }, null, 2)}\n`;
}

function readSessionFileContents(sessionsDir: string, sessionId: string): string | undefined {
  const path = sessionFilePath(sessionsDir, sessionId);
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function readCatalog(catalogPath: string): ChatSessionCatalog | undefined {
  if (!existsSync(catalogPath)) {
    return undefined;
  }

  try {
    return parseCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
  } catch {
    return undefined;
  }
}

function dedupeSessionsById(sessions: ChatSession[]): ChatSession[] {
  const seen = new Set<string>();
  const deduped: ChatSession[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) {
      continue;
    }

    seen.add(session.id);
    deduped.push(session);
  }

  return deduped;
}

function sessionFilePath(sessionsDir: string, sessionId: string): string {
  return join(sessionsDir, `${sessionId}.json`);
}

function removeOrphanedSessionFiles(sessionsDir: string, activeSessionIds: string[]) {
  if (!existsSync(sessionsDir)) {
    return;
  }

  const allowed = new Set(activeSessionIds.map((id) => `${id}.json`));
  for (const name of safeReadDirFiles(sessionsDir)) {
    if (allowed.has(name) || !name.endsWith('.json')) {
      continue;
    }

    unlinkSync(join(sessionsDir, name));
  }
}

function safeReadDirFiles(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function parseSavedSession(value: unknown, apiKeyPresent: boolean): ChatSession[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = value as Partial<ChatSession>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return [];
  }

  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
  const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : createdAt;

  return [{
    id: candidate.id,
    name: candidate.name,
    workspaceId: typeof candidate.workspaceId === 'string' ? candidate.workspaceId : undefined,
    history: Array.isArray(candidate.history) ? candidate.history as ChatMessage[] : [],
    messages:
      Array.isArray(candidate.messages) && candidate.messages.length > 0 ?
        candidate.messages.filter(isConversationLine)
      : createInitialMessages(apiKeyPresent),
    turns: Array.isArray(candidate.turns) ? candidate.turns.filter(isTurnSummary) : [],
    createdAt,
    updatedAt,
    model: typeof candidate.model === 'string' ? candidate.model : undefined,
    driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : false,
    lastContinuePrompt: typeof candidate.lastContinuePrompt === 'string' ? candidate.lastContinuePrompt : undefined,
    context: isChatContextStats(candidate.context) ? candidate.context : undefined,
    archives: Array.isArray(candidate.archives) ? candidate.archives.flatMap(parseArchiveRecord) : undefined,
    lease: parseLease(candidate.lease),
  }];
}

function parseLease(value: unknown): ChatSessionLease | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Partial<ChatSessionLease>;
  if (
    (candidate.ownerKind !== 'tui' && candidate.ownerKind !== 'daemon' && candidate.ownerKind !== 'ask') ||
    typeof candidate.ownerId !== 'string' ||
    typeof candidate.acquiredAt !== 'string' ||
    typeof candidate.lastSeenAt !== 'string'
  ) {
    return undefined;
  }

  return {
    ownerKind: candidate.ownerKind,
    ownerId: candidate.ownerId,
    acquiredAt: candidate.acquiredAt,
    lastSeenAt: candidate.lastSeenAt,
    clientLabel: typeof candidate.clientLabel === 'string' ? candidate.clientLabel : undefined,
  };
}

function isConversationLine(value: unknown): value is ConversationLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ConversationLine>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.text === 'string'
  );
}

function isTurnSummary(value: unknown): value is TurnSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<TurnSummary>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.outcome === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.steps === 'number' &&
    typeof candidate.traceFile === 'string' &&
    Array.isArray(candidate.events) &&
    candidate.events.every((event) => typeof event === 'string')
  );
}

function isChatContextStats(value: unknown): value is ChatContextStats {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ChatContextStats>;
  return (
    typeof candidate.estimatedHistoryTokens === 'number' &&
    (candidate.estimatedRequestTokens === undefined || typeof candidate.estimatedRequestTokens === 'number') &&
    (candidate.lastRunInputTokens === undefined || typeof candidate.lastRunInputTokens === 'number') &&
    (candidate.lastRunOutputTokens === undefined || typeof candidate.lastRunOutputTokens === 'number') &&
    (candidate.lastRunTotalTokens === undefined || typeof candidate.lastRunTotalTokens === 'number') &&
    (candidate.cachedInputTokens === undefined || typeof candidate.cachedInputTokens === 'number') &&
    (candidate.reasoningTokens === undefined || typeof candidate.reasoningTokens === 'number') &&
    (candidate.compactedMessages === undefined || typeof candidate.compactedMessages === 'number') &&
    (candidate.compactedAt === undefined || typeof candidate.compactedAt === 'string') &&
    (candidate.compactionStatus === undefined || candidate.compactionStatus === 'idle' || candidate.compactionStatus === 'running' || candidate.compactionStatus === 'failed') &&
    (candidate.compactionError === undefined || typeof candidate.compactionError === 'string') &&
    (candidate.archiveCount === undefined || typeof candidate.archiveCount === 'number') &&
    (candidate.currentSummaryPath === undefined || typeof candidate.currentSummaryPath === 'string') &&
    (candidate.lastArchivePath === undefined || typeof candidate.lastArchivePath === 'string')
  );
}

function parseArchiveRecord(value: unknown): ChatArchiveRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = value as Partial<ChatArchiveRecord>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.path !== 'string'
    || typeof candidate.summaryPath !== 'string'
    || typeof candidate.messageCount !== 'number'
    || typeof candidate.createdAt !== 'string'
  ) {
    return [];
  }

  return [{
    id: candidate.id,
    path: candidate.path,
    summaryPath: candidate.summaryPath,
    shortDescription: typeof candidate.shortDescription === 'string' ? candidate.shortDescription : undefined,
    messageCount: candidate.messageCount,
    createdAt: candidate.createdAt,
    summaryModel: typeof candidate.summaryModel === 'string' ? candidate.summaryModel : undefined,
  }];
}

function readObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
