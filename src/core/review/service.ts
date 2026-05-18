import * as gitDiffParser from 'gitdiff-parser';
import type {
  Change as ParsedGitDiffChange,
  File as ParsedGitDiffFile,
} from 'gitdiff-parser';

import type {
  ReviewDiffFile,
  ReviewDiffHunk,
  ReviewDiffLine,
  ReviewFileStatus,
} from './types.js';

type GitDiffParserModule = {
  default?: {
    parse?: (source: string) => ParsedGitDiffFile[];
  };
  parse?: (source: string) => ParsedGitDiffFile[];
};

/**
 * Parses unified Git diffs into Heddle's review model.
 *
 * This class owns the boundary between the third-party diff parser shape and
 * the stable review data consumed by server/control-plane presenters.
 */
export class ReviewDiffParser {
  private static readonly parser = (gitDiffParser as unknown as GitDiffParserModule).default?.parse
    ?? (gitDiffParser as unknown as GitDiffParserModule).parse;

  static parseUnifiedDiffFiles(diff: string): ReviewDiffFile[] {
    const normalized = diff.trim();
    if (!normalized || !normalized.includes('diff --git ')) {
      return [];
    }

    let parsed: ParsedGitDiffFile[];
    try {
      parsed = ReviewDiffParser.parser ? ReviewDiffParser.parser(normalized) : [];
    } catch {
      return [];
    }

    const chunks = ReviewDiffParser.splitUnifiedDiffChunks(normalized);
    return parsed.map((file) => ReviewDiffParser.projectParsedFile(file, chunks));
  }

  private static splitUnifiedDiffChunks(diff: string): string[] {
    return diff
      .split(/\n(?=diff --git )/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }

  private static projectParsedFile(file: ParsedGitDiffFile, chunks: string[]): ReviewDiffFile {
    const patch = ReviewDiffParser.findUnifiedDiffChunkForFile(chunks, file) ?? ReviewDiffParser.renderParsedGitDiffFile(file);
    const hunks = file.hunks.map((hunk) => ({
      header: hunk.content,
      lines: hunk.changes.map(ReviewDiffParser.projectDiffLine),
    }));
    const counts = ReviewDiffParser.countDiffLines(hunks);

    return {
      path: ReviewDiffParser.pathForParsedGitDiffFile(file),
      oldPath: ReviewDiffParser.oldPathForParsedGitDiffFile(file),
      status: ReviewDiffParser.statusFromParsedGitDiffFile(file),
      patch,
      binary: file.isBinary === true || /Binary files .* differ/.test(patch),
      additions: counts.additions,
      deletions: counts.deletions,
      hunks,
    };
  }

  private static findUnifiedDiffChunkForFile(chunks: string[], file: ParsedGitDiffFile): string | undefined {
    const candidates = [
      `diff --git a/${file.oldPath} b/${file.newPath}`,
      `rename from ${file.oldPath}`,
      `rename to ${file.newPath}`,
      `--- a/${file.oldPath}`,
      `+++ b/${file.newPath}`,
    ];

    return chunks.find((chunk) => candidates.some((candidate) => chunk.includes(candidate)));
  }

  private static renderParsedGitDiffFile(file: ParsedGitDiffFile): string {
    const oldPath = file.type === 'add' ? '/dev/null' : `a/${file.oldPath}`;
    const newPath = file.type === 'delete' ? '/dev/null' : `b/${file.newPath}`;
    const lines = [
      `diff --git a/${file.oldPath} b/${file.newPath}`,
      `--- ${oldPath}`,
      `+++ ${newPath}`,
    ];

    for (const hunk of file.hunks) {
      lines.push(hunk.content);
      for (const change of hunk.changes) {
        lines.push(change.content);
      }
    }

    return lines.join('\n');
  }

  private static pathForParsedGitDiffFile(file: ParsedGitDiffFile): string {
    return file.type === 'delete' ? file.oldPath : file.newPath;
  }

  private static oldPathForParsedGitDiffFile(file: ParsedGitDiffFile): string | undefined {
    if (file.type === 'add' || file.type === 'delete') {
      return undefined;
    }
    if (file.oldPath === file.newPath) {
      return undefined;
    }
    return file.oldPath;
  }

  private static statusFromParsedGitDiffFile(file: ParsedGitDiffFile): ReviewFileStatus {
    if (file.oldPath !== file.newPath && file.type === 'modify') {
      return 'renamed';
    }

    switch (file.type) {
      case 'add':
        return 'added';
      case 'delete':
        return 'deleted';
      case 'rename':
        return 'renamed';
      case 'copy':
        return 'copied';
      case 'modify':
        return 'modified';
      default:
        return 'unknown';
    }
  }

  private static projectDiffLine(change: ParsedGitDiffChange): ReviewDiffLine {
    return {
      type: ReviewDiffParser.lineTypeFromChange(change),
      content: change.content,
      oldLineNumber: 'oldLineNumber' in change && typeof change.oldLineNumber === 'number' ? change.oldLineNumber : undefined,
      newLineNumber: 'newLineNumber' in change && typeof change.newLineNumber === 'number' ? change.newLineNumber : undefined,
    };
  }

  private static lineTypeFromChange(change: ParsedGitDiffChange): ReviewDiffLine['type'] {
    switch (change.type) {
      case 'insert':
        return 'added';
      case 'delete':
        return 'deleted';
      case 'normal':
        return 'context';
      default:
        return 'unknown';
    }
  }

  private static countDiffLines(hunks: ReviewDiffHunk[]): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'added') {
          additions += 1;
        }
        if (line.type === 'deleted') {
          deletions += 1;
        }
      }
    }
    return { additions, deletions };
  }
}
