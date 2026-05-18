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
