import type { ChatSessionDetail, ChatTurnReview, WorkspaceChanges, WorkspaceFileDiff } from '../../../../lib/api';

export type SessionTurn = NonNullable<ChatSessionDetail>['turns'][number];
export type ReviewMode = 'current' | 'turn' | 'evidence';
export type ExpandedDiff = {
  title: string;
  subtitle: string;
  diff?: WorkspaceFileDiff['diff'];
  patch?: string;
  fallbackTitle: string;
  files?: ExpandedDiffFile[];
};

export type WorkspaceChangedFileValue = WorkspaceChanges['files'][number];
export type ReviewFileValue = WorkspaceChangedFileValue | NonNullable<ChatTurnReview>['files'][number];
export type ExpandedDiffFile = {
  title: string;
  diff?: WorkspaceFileDiff['diff'];
  patch?: string;
  fallbackTitle: string;
};
