import * as gitDiffParser from 'gitdiff-parser';
import type {
  Change as ParsedGitDiffChange,
  File as ParsedGitDiffFile,
} from 'gitdiff-parser';

export type ReviewFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown';

export type ReviewDiffLine = {
  type: 'context' | 'added' | 'deleted' | 'unknown';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export type ReviewDiffHunk = {
  header: string;
  lines: ReviewDiffLine[];
};

export type ReviewDiffFile = {
  path: string;
  oldPath?: string;
  status: ReviewFileStatus;
  patch?: string;
  binary?: boolean;
  additions: number;
  deletions: number;
  hunks: ReviewDiffHunk[];
};

type GitDiffParserModule = {
  default?: {
    parse?: (source: string) => ParsedGitDiffFile[];
  };
  parse?: (source: string) => ParsedGitDiffFile[];
};

const gitDiffParserModule = gitDiffParser as unknown as GitDiffParserModule;
const parseGitDiff = gitDiffParserModule.default?.parse ?? gitDiffParserModule.parse;

export function parseUnifiedDiffFiles(diff: string): ReviewDiffFile[] {
  const normalized = diff.trim();
  if (!normalized || !normalized.includes('diff --git ')) {
    return [];
  }

  let parsed: ParsedGitDiffFile[];
  try {
    parsed = parseGitDiff ? parseGitDiff(normalized) : [];
  } catch {
    return [];
  }

  const chunks = splitUnifiedDiffChunks(normalized);
  return parsed.map((file) => {
    const patch = findUnifiedDiffChunkForFile(chunks, file) ?? renderParsedGitDiffFile(file);
    const hunks = file.hunks.map((hunk) => ({
      header: hunk.content,
      lines: hunk.changes.map(projectDiffLine),
    }));
    const counts = countDiffLines(hunks);
    return {
      path: pathForParsedGitDiffFile(file),
      oldPath: oldPathForParsedGitDiffFile(file),
      status: statusFromParsedGitDiffFile(file),
      patch,
      binary: file.isBinary === true || /Binary files .* differ/.test(patch),
      additions: counts.additions,
      deletions: counts.deletions,
      hunks,
    };
  });
}

export function splitUnifiedDiffChunks(diff: string): string[] {
  return diff
    .split(/\n(?=diff --git )/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function findUnifiedDiffChunkForFile(chunks: string[], file: ParsedGitDiffFile): string | undefined {
  const candidates = [
    `diff --git a/${file.oldPath} b/${file.newPath}`,
    `rename from ${file.oldPath}`,
    `rename to ${file.newPath}`,
    `--- a/${file.oldPath}`,
    `+++ b/${file.newPath}`,
  ];

  return chunks.find((chunk) => candidates.some((candidate) => chunk.includes(candidate)));
}

function renderParsedGitDiffFile(file: ParsedGitDiffFile): string {
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

function pathForParsedGitDiffFile(file: ParsedGitDiffFile): string {
  return file.type === 'delete' ? file.oldPath : file.newPath;
}

function oldPathForParsedGitDiffFile(file: ParsedGitDiffFile): string | undefined {
  if (file.type === 'add' || file.type === 'delete') {
    return undefined;
  }
  if (file.oldPath === file.newPath) {
    return undefined;
  }
  return file.oldPath;
}

function statusFromParsedGitDiffFile(file: ParsedGitDiffFile): ReviewFileStatus {
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

function projectDiffLine(change: ParsedGitDiffChange): ReviewDiffLine {
  return {
    type: lineTypeFromChange(change),
    content: change.content,
    oldLineNumber: 'oldLineNumber' in change && typeof change.oldLineNumber === 'number' ? change.oldLineNumber : undefined,
    newLineNumber: 'newLineNumber' in change && typeof change.newLineNumber === 'number' ? change.newLineNumber : undefined,
  };
}

function lineTypeFromChange(change: ParsedGitDiffChange): ReviewDiffLine['type'] {
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

function countDiffLines(hunks: ReviewDiffHunk[]): { additions: number; deletions: number } {
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
