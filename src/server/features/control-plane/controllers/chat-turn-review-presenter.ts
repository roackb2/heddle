import { existsSync, readFileSync } from 'node:fs';
import { ReviewDiffParser } from '@/core/review/index.js';
import type {
  ApprovalEventView,
  ChangedFileReviewView,
  ChatTurnReview,
  CommandEvidenceView,
} from '../types.js';
import {
  normalizeCommandText,
  readBoolean,
  readNumber,
  readObject,
  readString,
} from '../helpers/read-values.js';

export class ControlPlaneChatTurnReviewPresenter {
  static load(traceFile: string): ChatTurnReview | undefined {
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
            const file = ControlPlaneChatTurnReviewPresenter.projectEditFileReview(output);
            if (file) {
              ControlPlaneChatTurnReviewPresenter.addChangedFile(files, file);
            }
          }

          const output = readObject(result?.output);
          const evidence = output ? ControlPlaneChatTurnReviewPresenter.projectCommandEvidence(tool, output) : undefined;
          if (!evidence) {
            continue;
          }

          if (ControlPlaneChatTurnReviewPresenter.isReviewCommand(evidence.command)) {
            reviewCommands.push(evidence);
            if (!diffExcerpt && /^git diff(?:\s|$)/.test(evidence.command) && evidence.stdout) {
              diffExcerpt = evidence.stdout;
            }
            if (/^git diff(?:\s|$)/.test(evidence.command) && evidence.stdout) {
              for (const file of ControlPlaneChatTurnReviewPresenter.parseGitDiffFiles(evidence.stdout)) {
                ControlPlaneChatTurnReviewPresenter.addChangedFile(files, file);
              }
            }
            continue;
          }

          if (ControlPlaneChatTurnReviewPresenter.isVerificationCommand(evidence.command)) {
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
        reviewCommands: ControlPlaneChatTurnReviewPresenter.dedupeEvidence(reviewCommands),
        verificationCommands: ControlPlaneChatTurnReviewPresenter.dedupeEvidence(verificationCommands),
        mutationCommands: ControlPlaneChatTurnReviewPresenter.dedupeEvidence(mutationCommands),
        approvals,
      };
    } catch {
      return undefined;
    }
  }

  private static projectCommandEvidence(tool: string, output: Record<string, unknown>): CommandEvidenceView | undefined {
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

  private static dedupeEvidence(evidence: CommandEvidenceView[]): CommandEvidenceView[] {
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

  private static isReviewCommand(command: string): boolean {
    return /^git (?:status\b|diff\b|show\b|branch\b|remote\b)/.test(command);
  }

  private static isVerificationCommand(command: string): boolean {
    return /^(?:yarn|npm|pnpm|bun|vitest|jest|tsx|tsc|go test|cargo test|pytest|ruff|eslint)\b/.test(command);
  }

  private static projectEditFileReview(output: Record<string, unknown> | undefined): ChangedFileReviewView | undefined {
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
      status: ControlPlaneChatTurnReviewPresenter.statusFromEditAction(readString(output.action)),
      source: 'edit_file',
      patch,
      diff: patch ? ReviewDiffParser.parseUnifiedDiffFiles(patch).find((file) => file.path === path || file.oldPath === path) : undefined,
      truncated: readBoolean(diff?.truncated),
    };
  }

  private static statusFromEditAction(action: string | undefined): ChangedFileReviewView['status'] {
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

  private static parseGitDiffFiles(diff: string): ChangedFileReviewView[] {
    return ReviewDiffParser.parseUnifiedDiffFiles(diff).map((file) => ({
      path: file.path,
      status: file.status === 'copied' ? 'modified' : file.status,
      source: 'git_diff' as const,
      patch: normalizeCommandText(file.patch),
      diff: file,
      truncated: file.binary === true,
    }));
  }

  private static addChangedFile(files: Map<string, ChangedFileReviewView>, file: ChangedFileReviewView) {
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
}
