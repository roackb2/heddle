import { existsSync, readFileSync } from 'node:fs';
import type {
  ApprovalEventView,
  ChatSessionDetail,
  ChatSessionMessage,
  ChatSessionView,
  ChatTurnReview,
  ChatTurnView,
  CommandEvidenceView,
} from '../types.js';

export function readChatSessionViews(sessionsPath: string): ChatSessionView[] {
  return readChatSessionRecords(sessionsPath).flatMap(projectChatSessionView).sort((left, right) => {
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  });
}

export function readChatSessionDetail(sessionsPath: string, id: string): ChatSessionDetail | undefined {
  return readChatSessionRecords(sessionsPath)
    .flatMap(projectChatSessionDetail)
    .find((session) => session.id === id);
}

export function readChatTurnReview(sessionsPath: string, sessionId: string, turnId: string): ChatTurnReview | undefined {
  const session = readChatSessionDetail(sessionsPath, sessionId);
  const turn = session?.turns.find((candidate) => candidate.id === turnId);
  if (!turn) {
    return undefined;
  }

  return loadChatTurnReview(turn.traceFile);
}

export function projectChatSessionView(raw: unknown): ChatSessionView[] {
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

  return [{
    id,
    name,
    createdAt: readString(candidate.createdAt),
    updatedAt: readString(candidate.updatedAt),
    model: readString(candidate.model),
    driftEnabled: typeof candidate.driftEnabled === 'boolean' ? candidate.driftEnabled : undefined,
    messageCount: messages.length,
    turnCount: turns.length,
    lastPrompt: readString(lastTurn?.prompt),
    lastOutcome: readString(lastTurn?.outcome),
    lastSummary: readString(lastTurn?.summary),
    context: context ? {
      estimatedHistoryTokens: readNumber(context.estimatedHistoryTokens),
      estimatedRequestTokens: readNumber(context.estimatedRequestTokens),
      lastRunInputTokens: readNumber(context.lastRunInputTokens),
      lastRunOutputTokens: readNumber(context.lastRunOutputTokens),
      lastRunTotalTokens: readNumber(context.lastRunTotalTokens),
    } : undefined,
  }];
}

export function projectChatSessionDetail(raw: unknown): ChatSessionDetail[] {
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

function readChatSessionRecords(sessionsPath: string): unknown[] {
  if (!existsSync(sessionsPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(sessionsPath, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
