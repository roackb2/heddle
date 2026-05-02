import type { ChatSessionDetail, ChatTurnReview, WorkspaceChanges, WorkspaceFileDiff } from '../../../lib/api';
import {
  CurrentWorkspaceReviewSection,
  HistoricalTurnReviewSection,
  ReviewEvidenceSection,
} from '../components/session-review-panel/ReviewSections';
import type { ExpandedDiff, ReviewMode, SessionTurn } from '../components/session-review-panel/types';
import { className } from '../utils';

export type { ExpandedDiff, ReviewMode } from '../components/session-review-panel/types';
export { FullDiffDialog } from '../components/session-review-panel/ReviewSections';

type SessionReviewPanelProps = {
  reviewMode: ReviewMode;
  onReviewModeChange: (mode: ReviewMode) => void;
  onShowChatView: () => void;
  workspaceChanges: WorkspaceChanges | null;
  workspaceChangesLoading: boolean;
  workspaceChangesError?: string;
  workspaceFileDiffsByPath: Record<string, WorkspaceFileDiff>;
  workspaceFileDiffLoading: boolean;
  workspaceFileDiffError?: string;
  selectedTurnPatchIsStale: boolean;
  onSelectWorkspaceFile: (path: string) => void;
  onRefreshWorkspaceReview: () => void;
  sessionDetail: ChatSessionDetail | null;
  selectedTurnId?: string;
  onSelectTurn: (turnId: string) => void;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  onSelectReviewFile: (path: string) => void;
  selectedTurn?: SessionTurn;
  onOpenDiff: (diff: ExpandedDiff) => void;
};

export function SessionReviewPanel({
  reviewMode,
  onReviewModeChange,
  onShowChatView,
  workspaceChanges,
  workspaceChangesLoading,
  workspaceChangesError,
  workspaceFileDiffsByPath,
  workspaceFileDiffLoading,
  workspaceFileDiffError,
  selectedTurnPatchIsStale,
  onSelectWorkspaceFile,
  onRefreshWorkspaceReview,
  sessionDetail,
  selectedTurnId,
  onSelectTurn,
  turnReview,
  turnReviewLoading,
  turnReviewError,
  onSelectReviewFile,
  selectedTurn,
  onOpenDiff,
}: SessionReviewPanelProps) {
  return (
    <aside className="workspace-side">
      <div className="mobile-side-header">
        <button className="mobile-nav-button" type="button" onClick={onShowChatView}>← Chat</button>
      </div>
      <div className="side-scroll">
        <nav className="side-tabs review-mode-tabs" role="tablist" aria-label="Review mode">
          <button className={className(reviewMode === 'current' && 'active')} type="button" onClick={() => onReviewModeChange('current')}>Current</button>
          <button className={className(reviewMode === 'turn' && 'active')} type="button" onClick={() => onReviewModeChange('turn')}>Turn history</button>
          <button className={className(reviewMode === 'evidence' && 'active')} type="button" onClick={() => onReviewModeChange('evidence')}>Evidence</button>
        </nav>

        {reviewMode === 'current' ?
          <CurrentWorkspaceReviewSection
            workspaceChanges={workspaceChanges}
            workspaceChangesLoading={workspaceChangesLoading}
            workspaceChangesError={workspaceChangesError}
            workspaceFileDiffsByPath={workspaceFileDiffsByPath}
            workspaceFileDiffLoading={workspaceFileDiffLoading}
            workspaceFileDiffError={workspaceFileDiffError}
            selectedTurnPatchIsStale={selectedTurnPatchIsStale}
            onSelectWorkspaceFile={onSelectWorkspaceFile}
            onRefresh={onRefreshWorkspaceReview}
            onOpenDiff={onOpenDiff}
          />
        : reviewMode === 'turn' ?
          <HistoricalTurnReviewSection
            sessionDetail={sessionDetail}
            selectedTurnId={selectedTurnId}
            onSelectTurn={onSelectTurn}
            turnReview={turnReview}
            turnReviewLoading={turnReviewLoading}
            turnReviewError={turnReviewError}
            onSelectReviewFile={onSelectReviewFile}
            onOpenDiff={onOpenDiff}
          />
        : <ReviewEvidenceSection turnReview={turnReview} selectedTurn={selectedTurn} />}
      </div>
    </aside>
  );
}
