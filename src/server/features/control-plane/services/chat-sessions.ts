import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createChatSession, readChatSession, readChatSessionCatalog, saveChatSessions } from '../../../../core/chat/storage.js';
import { DEFAULT_OPENAI_MODEL } from '../../../../core/config.js';
import { parseUnifiedDiffFiles } from '../../../../core/review/diff-domain.js';
import { resolveApiKeyForModel } from '../../../../core/runtime/api-keys.js';
import type { ChatSessionLeaseOwner } from '../../../../core/chat/session-lease.js';
import type { ChatSession } from '../../../../core/chat/types.js';
import { submitChatSessionPrompt } from '../../../../core/chat/session-submit.js';
import type {
  ApprovalEventView,
  ChatSessionDetail,
  ChatSessionMessage,
  ChatSessionView,
  ChatTurnReview,
  ChatTurnView,
  ChangedFileReviewView,
  CommandEvidenceView,
  ControlPlanePendingApproval,
  ControlPlaneSessionLiveEvent,
} from '../types.js';

type ChatSessionContextView = NonNullable<ChatSessionView['context']>;

type SubmitChatPromptArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  prompt: string;
  apiKey?: string;
  systemContext?: string;
  memoryMaintenanceMode?: 'none' | 'background' | 'inline';
  leaseOwner: ChatSessionLeaseOwner;
};

const DEFAULT_CONTINUE_PROMPT = 'Continue from where you left off.';

export function createControlPlaneChatSession(args: {
  sessionStoragePath: string;
  suggestedName?: string;
  workspaceId?: string;
  model?: string;
  apiKeyPresent?: boolean;
}): ChatSessionDetail {
  const existing = readChatSessionViews(args.sessionStoragePath);
  const nextNumber = existing.length + 1;
  const model = args.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const session = createChatSession({
    id: `session-${Date.now()}`,
    name: args.suggestedName?.trim() || `Session ${nextNumber}`,
    apiKeyPresent: args.apiKeyPresent ?? Boolean(resolveApiKeyForModel(model)),
    model,
    workspaceId: args.workspaceId,
  });

  const currentSessions = readChatSessionCatalog(args.sessionStoragePath)
    .map((entry) => readChatSession(args.sessionStoragePath, entry.id, Boolean(resolveApiKeyForModel(model))))
    .filter((candidate): candidate is ChatSession => Boolean(candidate));
  saveChatSessions(args.sessionStoragePath, [session, ...currentSessions]);
  return projectChatSessionDetail(session)[0] as ChatSessionDetail;
}

export function updateControlPlaneChatSessionSettings(args: {
  sessionStoragePath: string;
  sessionId: string;
  model?: string;
  driftEnabled?: boolean;
}): ChatSessionDetail {
  const currentSessions = readChatSessionCatalog(args.sessionStoragePath)
    .map((entry) => readChatSession(args.sessionStoragePath, entry.id, true))
    .filter((candidate): candidate is ChatSession => Boolean(candidate));
  const nextSessions = currentSessions.map((session) => (
    session.id === args.sessionId ?
      {
        ...session,
        model: args.model ?? session.model,
        driftEnabled: args.driftEnabled ?? session.driftEnabled,
        updatedAt: new Date().toISOString(),
      }
    : session
  ));
  const updated = nextSessions.find((session) => session.id === args.sessionId);
  if (!updated) {
    throw new Error(`Chat session not found: ${args.sessionId}`);
  }

  saveChatSessions(args.sessionStoragePath, nextSessions);
  return projectChatSessionDetail(updated)[0] as ChatSessionDetail;
}

const sessionEventBus = new EventEmitter();
const pendingApprovals = new Map<string, {
  approval: ControlPlanePendingApproval;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
}>();
const inFlightRuns = new Map<string, AbortController>();

export async function submitChatPrompt(args: SubmitChatPromptArgs) {
  if (inFlightRuns.has(args.sessionId)) {
    throw new Error('A run is already in progress for this session.');
  }

  const controller = new AbortController();
  inFlightRuns.set(args.sessionId, controller);

  try {
    const result = await submitChatSessionPrompt({
      ...args,
      apiKey: args.apiKey,
      memoryMaintenanceMode: args.memoryMaintenanceMode,
      abortSignal: controller.signal,
      onEvent: (event) => {
        sessionEventBus.emit(args.sessionId, {
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
          event,
        } satisfies ControlPlaneSessionLiveEvent);
      },
      approveToolCall: async (call, tool) => {
        const decision = await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
          pendingApprovals.set(args.sessionId, {
            approval: {
              tool: tool.name,
              callId: call.id,
              input: call.input,
              requestedAt: new Date().toISOString(),
            },
            resolve,
          });
          sessionEventBus.emit(args.sessionId, {
            sessionId: args.sessionId,
            timestamp: new Date().toISOString(),
            event: {
              type: 'trace',
              runId: 'pending-approval',
              timestamp: new Date().toISOString(),
              event: {
                type: 'tool.approval_requested',
                call,
                step: 0,
                timestamp: new Date().toISOString(),
              },
            },
          } satisfies ControlPlaneSessionLiveEvent);
        });
        pendingApprovals.delete(args.sessionId);
        return decision;
      },
      onCompactionStatus: (event) => {
        sessionEventBus.emit(args.sessionId, {
          sessionId: args.sessionId,
          timestamp: new Date().toISOString(),
          event,
        } satisfies ControlPlaneSessionLiveEvent);
      },
    });
    return {
      ...result,
      session: projectChatSessionDetail(result.session)[0] ?? null,
    };
  } finally {
    pendingApprovals.delete(args.sessionId);
    inFlightRuns.delete(args.sessionId);
  }
}

export async function continueChatPrompt(args: Omit<SubmitChatPromptArgs, 'prompt'>) {
  const session = readChatSession(args.sessionStoragePath, args.sessionId, true);
  if (!session) {
    throw new Error(`Chat session not found: ${args.sessionId}`);
  }

  if (!session.history.length || !session.lastContinuePrompt) {
    throw new Error('There is no interrupted or prior run to continue yet.');
  }

  return await submitChatPrompt({
    ...args,
    prompt: DEFAULT_CONTINUE_PROMPT,
  });
}

export function subscribeToControlPlaneSessionEvents(
  sessionId: string,
  listener: (event: ControlPlaneSessionLiveEvent) => void,
): () => void {
  sessionEventBus.on(sessionId, listener);
  return () => {
    sessionEventBus.off(sessionId, listener);
  };
}

export function getPendingControlPlaneApproval(sessionId: string): ControlPlanePendingApproval | undefined {
  return pendingApprovals.get(sessionId)?.approval;
}

export function isControlPlaneSessionRunning(sessionId: string): boolean {
  return inFlightRuns.has(sessionId);
}

export function cancelControlPlaneSessionRun(sessionId: string): boolean {
  const controller = inFlightRuns.get(sessionId);
  if (!controller) {
    return false;
  }

  controller.abort();
  pendingApprovals.delete(sessionId);
  return true;
}

export function resolvePendingControlPlaneApproval(
  sessionId: string,
  decision: { approved: boolean; reason?: string },
): boolean {
  const pending = pendingApprovals.get(sessionId);
  if (!pending) {
    return false;
  }

  pendingApprovals.delete(sessionId);
  pending.resolve(decision);
  return true;
}

export function readChatSessionViews(sessionStoragePath: string): ChatSessionView[] {
  return readChatSessionCatalog(sessionStoragePath)
    .flatMap(projectChatSessionView)
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
}

export function readChatSessionDetail(sessionStoragePath: string, id: string): ChatSessionDetail | undefined {
  const session = readChatSession(sessionStoragePath, id, true);
  return session ? projectChatSessionDetail(session)[0] : undefined;
}

export function readChatTurnReview(sessionStoragePath: string, sessionId: string, turnId: string): ChatTurnReview | undefined {
  const session = readChatSessionDetail(sessionStoragePath, sessionId);
  const turn = session?.turns.find((candidate) => candidate.id === turnId);
  if (!turn) {
    return undefined;
  }

  return loadChatTurnReview(turn.traceFile);
}

export function resolveChatSessionFilePath(stateRoot: string, sessionId: string): string {
  return join(stateRoot, 'chat-sessions', `${sessionId}.json`);
}

export function projectChatSessionView(raw: unknown | ChatSession): ChatSessionView[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const candidate = raw as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id : undefined;
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  if (!id || !name) {
    return [];
  }

  const turns = Array.isArray(candidate.turns) ? candidate.turns : [];
  const messages = Array.isArray(candidate.messages) ? candidate.messages : [];
  const lastTurn = readObject(turns.at(-1));
  const context = readObject(candidate.context);
  const archives = Array.isArray(candidate.archives) ? candidate.archives.map(readObject).filter(Boolean) : [];
  const rawCompactionStatus = readString(context?.compactionStatus);
  const compactionStatus: ChatSessionContextView['compactionStatus'] =
    rawCompactionStatus === 'idle' || rawCompactionStatus === 'running' || rawCompactionStatus === 'failed' ?
      rawCompactionStatus
    : undefined;

  const contextView =
    context ?
      omitUndefined({
        estimatedHistoryTokens: readNumber(context.estimatedHistoryTokens),
        estimatedRequestTokens: readNumber(context.estimatedRequestTokens),
        lastRunInputTokens: readNumber(context.lastRunInputTokens),
        lastRunOutputTokens: readNumber(context.lastRunOutputTokens),
        lastRunTotalTokens: readNumber(context.lastRunTotalTokens),
        compactedMessages: readNumber(context.compactedMessages),
        compactedAt: readString(context.compactedAt),
        compactionStatus,
        compactionError: readString(context.compactionError),
        archiveCount: readNumber(context.archiveCount),
        currentSummaryPath: readString(context.currentSummaryPath),
        lastArchivePath: readString(context.lastArchivePath),
      })
    : undefined;
  const archiveViews = archives.flatMap((archive) => {
    const archiveObject = readObject(archive);
    if (!archiveObject) {
      return [];
    }

    const id = readString(archiveObject.id);
    const path = readString(archiveObject.path);
    const summaryPath = readString(archiveObject.summaryPath);
    const messageCount = readNumber(archiveObject.messageCount);
    const createdAt = readString(archiveObject.createdAt);
    if (!id || !path || !summaryPath || messageCount === undefined || !createdAt) {
      return [];
    }

    return [omitUndefined({
      id,
      path,
      summaryPath,
      shortDescription: readString(archiveObject.shortDescription),
      messageCount,
      createdAt,
      summaryModel: readString(archiveObject.summaryModel),
    })];
  });

  return [omitUndefined({
    id,
    name,
    workspaceId: readString(candidate.workspaceId),
    createdAt: readString(candidate.createdAt),
    updatedAt: readString(candidate.updatedAt),
    model: readString(candidate.model),
    driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : undefined,
    driftLevel: readLatestDriftLevel(turns),
    messageCount: messages.length,
    turnCount: turns.length,
    lastPrompt: readString(lastTurn?.prompt),
    lastOutcome: readString(lastTurn?.outcome),
    lastSummary: readString(lastTurn?.summary),
    context: contextView && Object.keys(contextView).length > 0 ? contextView : undefined,
    archives: archiveViews.length > 0 ? archiveViews : undefined,
  })];
}

function readLatestDriftLevel(turns: unknown[]): ChatSessionView['driftLevel'] {
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = readObject(turns[index]);
    const traceFile = readString(turn?.traceFile);
    const driftLevel = traceFile ? readLatestDriftLevelFromTrace(traceFile) : undefined;
    if (driftLevel) {
      return driftLevel;
    }
  }

  return undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function readLatestDriftLevelFromTrace(traceFile: string): ChatSessionView['driftLevel'] {
  if (!traceFile || !existsSync(traceFile)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(traceFile, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    for (let index = parsed.length - 1; index >= 0; index--) {
      const event = readObject(parsed[index]);
      if (event?.type !== 'cyberloop.annotation') {
        continue;
      }

      const driftLevel = readString(event.driftLevel);
      if (driftLevel === 'unknown' || driftLevel === 'low' || driftLevel === 'medium' || driftLevel === 'high') {
        return driftLevel;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function projectChatSessionDetail(raw: unknown | ChatSession): ChatSessionDetail[] {
  const base = projectChatSessionView(raw)[0];
  if (!base || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const candidate = raw as Record<string, unknown>;
  const messages = Array.isArray(candidate.messages) ? candidate.messages.flatMap(projectChatSessionMessage) : [];
  const turns = Array.isArray(candidate.turns) ? candidate.turns.flatMap(projectChatTurnView) : [];

  return [{
    ...base,
    messages,
    turns,
    lastContinuePrompt: readString(candidate.lastContinuePrompt),
  }];
}

function projectChatSessionMessage(raw: unknown): ChatSessionMessage[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const candidate = raw as Record<string, unknown>;
  const id = readString(candidate.id);
  const role = candidate.role === 'user' || candidate.role === 'assistant' ? candidate.role : undefined;
  const text = readString(candidate.text);
  if (!id || !role || !text) {
    return [];
  }

  return [{
    id,
    role,
    text,
    isStreaming: readBoolean(candidate.isStreaming),
    isPending: readBoolean(candidate.isPending),
  }];
}

function projectChatTurnView(raw: unknown): ChatTurnView[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const candidate = raw as Record<string, unknown>;
  const id = readString(candidate.id);
  const prompt = readString(candidate.prompt);
  const outcome = readString(candidate.outcome);
  const summary = readString(candidate.summary);
  const traceFile = readString(candidate.traceFile);
  const steps = readNumber(candidate.steps);
  const events = Array.isArray(candidate.events) ? candidate.events.filter((event): event is string => typeof event === 'string') : [];
  if (!id || !prompt || !outcome || !summary || !traceFile || steps === undefined) {
    return [];
  }

  return [{
    id,
    prompt,
    outcome,
    summary,
    steps,
    traceFile,
    events,
  }];
}

function loadChatTurnReview(traceFile: string): ChatTurnReview | undefined {
  if (!traceFile || !existsSync(traceFile)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(traceFile, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const reviewCommands: CommandEvidenceView[] = [];
    const verificationCommands: CommandEvidenceView[] = [];
    const mutationCommands: CommandEvidenceView[] = [];
    const approvals: ApprovalEventView[] = [];
    const files = new Map<string, ChangedFileReviewView>();
    let diffExcerpt: string | undefined;
    let finalSummary: string | undefined;

    for (const entry of parsed) {
      const event = readObject(entry);
      const type = readString(event?.type);
      if (!event || !type) {
        continue;
      }

      if (type === 'tool.result') {
        const tool = readString(event.tool) ?? 'unknown';
        const result = readObject(event.result);
        if (tool === 'edit_file' && readBoolean(result?.ok) === true) {
          const output = readObject(result?.output);
          const file = projectEditFileReview(output);
          if (file) {
            addChangedFile(files, file);
          }
        }

        const output = readObject(result?.output);
        const evidence = output ? projectCommandEvidence(tool, output) : undefined;
        if (!evidence) {
          continue;
        }

        if (isReviewCommand(evidence.command)) {
          reviewCommands.push(evidence);
          if (!diffExcerpt && /^git diff(?:\s|$)/.test(evidence.command) && evidence.stdout) {
            diffExcerpt = evidence.stdout;
          }
          if (/^git diff(?:\s|$)/.test(evidence.command) && evidence.stdout) {
            for (const file of parseGitDiffFiles(evidence.stdout)) {
              addChangedFile(files, file);
            }
          }
          continue;
        }

        if (isVerificationCommand(evidence.command)) {
          verificationCommands.push(evidence);
          continue;
        }

        if (tool === 'run_shell_mutate') {
          mutationCommands.push(evidence);
        }
        continue;
      }

      if (type === 'tool.call') {
        const call = readObject(event.call);
        const tool = readString(call?.tool);
        if (tool !== 'edit_file') {
          continue;
        }

        const input = readObject(call?.input);
        const path = readString(input?.path);
        mutationCommands.push({
          tool,
          command: path ? `edit_file ${path}` : 'edit_file',
        });
        continue;
      }

      if (type === 'tool.approval_resolved') {
        const call = readObject(event.call);
        const tool = readString(call?.tool);
        if (!tool) {
          continue;
        }

        const input = readObject(call?.input);
        approvals.push({
          tool,
          command: readString(input?.command) ?? readString(input?.path),
          approved: readBoolean(event.approved) ?? false,
          reason: readString(event.reason),
          timestamp: readString(event.timestamp),
        });
        continue;
      }

      if (type === 'run.finished') {
        finalSummary = readString(event.summary) ?? finalSummary;
      }
    }

    return {
      traceFile,
      diffExcerpt,
      finalSummary,
      files: [...files.values()],
      reviewCommands: dedupeEvidence(reviewCommands),
      verificationCommands: dedupeEvidence(verificationCommands),
      mutationCommands: dedupeEvidence(mutationCommands),
      approvals,
    };
  } catch {
    return undefined;
  }
}

function projectCommandEvidence(tool: string, output: Record<string, unknown>): CommandEvidenceView | undefined {
  const command = readString(output.command);
  if (!command) {
    return undefined;
  }

  return {
    tool,
    command,
    exitCode: readNumber(output.exitCode),
    stdout: normalizeCommandText(readString(output.stdout)),
    stderr: normalizeCommandText(readString(output.stderr)),
  };
}

function dedupeEvidence(evidence: CommandEvidenceView[]): CommandEvidenceView[] {
  const seen = new Set<string>();
  return evidence.filter((entry) => {
    const key = `${entry.tool}:${entry.command}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isReviewCommand(command: string): boolean {
  return /^git (?:status\b|diff\b|show\b|branch\b|remote\b)/.test(command);
}

function isVerificationCommand(command: string): boolean {
  return /^(?:yarn|npm|pnpm|bun|vitest|jest|tsx|tsc|go test|cargo test|pytest|ruff|eslint)\b/.test(command);
}

function projectEditFileReview(output: Record<string, unknown> | undefined): ChangedFileReviewView | undefined {
  if (!output) {
    return undefined;
  }

  const path = readString(output.path);
  const diff = readObject(output.diff);
  const patch = normalizeCommandText(readString(diff?.diff));
  if (!path) {
    return undefined;
  }

  return {
    path,
    status: statusFromEditAction(readString(output.action)),
    source: 'edit_file',
    patch,
    truncated: readBoolean(diff?.truncated),
  };
}

function statusFromEditAction(action: string | undefined): ChangedFileReviewView['status'] {
  switch (action) {
    case 'created':
      return 'added';
    case 'overwritten':
    case 'replaced':
      return 'modified';
    default:
      return 'unknown';
  }
}

function parseGitDiffFiles(diff: string): ChangedFileReviewView[] {
  return parseUnifiedDiffFiles(diff).map((file) => ({
    path: file.path,
    status: file.status === 'copied' ? 'modified' : file.status,
    source: 'git_diff' as const,
    patch: normalizeCommandText(file.patch),
    truncated: file.binary === true,
  }));
}

function addChangedFile(files: Map<string, ChangedFileReviewView>, file: ChangedFileReviewView) {
  const existing = files.get(file.path);
  if (!existing) {
    files.set(file.path, file);
    return;
  }

  if (existing.source === 'edit_file') {
    return;
  }

  if (file.source === 'edit_file' || (!existing.patch && file.patch)) {
    files.set(file.path, file);
  }
}

function normalizeCommandText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > 2400 ? `${trimmed.slice(0, 2399)}…` : trimmed;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
