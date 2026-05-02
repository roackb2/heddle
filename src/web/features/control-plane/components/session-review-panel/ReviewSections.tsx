import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../components/ui/tooltip';
import type { ChatSessionDetail, ChatTurnReview, WorkspaceChanges, WorkspaceFileDiff } from '../../../../lib/api';
import { CodeBlock, EmptyState, Pill, SideSection } from '../common';
import { DiffViewer } from '../DiffViewer';
import { CommandList, TurnListButton } from '../lists';
import { className } from '../../utils';
import type { ExpandedDiff, ExpandedDiffFile, ReviewFileValue, SessionTurn, WorkspaceChangedFileValue } from './types';

export function CurrentWorkspaceReviewSection({
  workspaceChanges,
  workspaceChangesLoading,
  workspaceChangesError,
  workspaceFileDiffsByPath,
  workspaceFileDiffLoading,
  workspaceFileDiffError,
  selectedTurnPatchIsStale,
  onSelectWorkspaceFile,
  onRefresh,
  onOpenDiff,
}: {
  workspaceChanges: WorkspaceChanges | null;
  workspaceChangesLoading: boolean;
  workspaceChangesError?: string;
  workspaceFileDiffsByPath: Record<string, WorkspaceFileDiff>;
  workspaceFileDiffLoading: boolean;
  workspaceFileDiffError?: string;
  selectedTurnPatchIsStale: boolean;
  onSelectWorkspaceFile: (path: string) => void;
  onRefresh: () => void;
  onOpenDiff: (diff: ExpandedDiff) => void;
}) {
  const fullWorkspaceDiff = buildWorkspaceExpandedDiff(workspaceChanges?.files ?? [], workspaceFileDiffsByPath);
  return (
    <SideSection
      title="Current workspace changes"
      testId="review-current-workspace"
      actions={
        <div className="review-section-actions">
          {selectedTurnPatchIsStale ? <StalePatchIndicator /> : null}
          {fullWorkspaceDiff.files?.length ?
            <Button type="button" variant="outline" size="sm" disabled={workspaceFileDiffLoading} onClick={() => onOpenDiff(fullWorkspaceDiff)}>
              Open full diff
            </Button>
          : null}
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={workspaceChangesLoading || workspaceFileDiffLoading}>
            Refresh
          </Button>
        </div>
      }
    >
      {workspaceChangesLoading ?
        <EmptyState title="Loading workspace diff" body="Reading current Git changes from the active workspace." />
      : workspaceChangesError ?
        <EmptyState title="Workspace diff failed" body={workspaceChangesError} />
      : workspaceChanges?.vcs === 'none' ?
        <EmptyState title="Not a git workspace" body={workspaceChanges.error ?? 'Current workspace changes require a Git-backed project.'} />
      : workspaceChanges?.files.length ?
        <div className="detail-stack compact-stack">
          <ChangedFilePicker
            files={workspaceChanges.files}
            sourceLabel="current git"
            testId="review-current-file-list"
            onSelect={onSelectWorkspaceFile}
            renderContent={(file) => {
              const fileDiff = workspaceFileDiffsByPath[file.path];
              return (
                <FileDiffPreview
                  loading={workspaceFileDiffLoading}
                  error={workspaceFileDiffError}
                  diffError={fileDiff?.error}
                  patch={fileDiff?.patch}
                  diff={fileDiff?.diff}
                  unavailableTitle="No patch available"
                  unavailableBody="Git reports this file as changed, but no patch text is available for it."
                  loadingTitle="Loading file diff"
                  loadingBody="Reading the selected file patch."
                  fallbackTitle="Raw workspace patch"
                />
              );
            }}
          />
        </div>
      : <EmptyState title="Clean workspace" body="Git does not report current project file changes." />}
    </SideSection>
  );
}

export function HistoricalTurnReviewSection({
  sessionDetail,
  selectedTurnId,
  onSelectTurn,
  turnReview,
  turnReviewLoading,
  turnReviewError,
  onSelectReviewFile,
  onOpenDiff,
}: {
  sessionDetail: ChatSessionDetail | null;
  selectedTurnId?: string;
  onSelectTurn: (turnId: string) => void;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  onSelectReviewFile: (path: string) => void;
  onOpenDiff: (diff: ExpandedDiff) => void;
}) {
  const fullTurnDiff = buildTurnExpandedDiff(turnReview?.files ?? []);
  return (
    <SideSection
      title="Captured turn diff"
      actions={fullTurnDiff.files?.length ?
        <Button type="button" variant="outline" size="sm" onClick={() => onOpenDiff(fullTurnDiff)}>
          Open full diff
        </Button>
      : undefined}
    >
      {sessionDetail?.turns.length ?
        <div className="stack-list compact review-turn-picker">
          {[...sessionDetail.turns].reverse().map((turn) => (
            <TurnListButton key={turn.id} turn={turn} active={turn.id === selectedTurnId} onClick={() => onSelectTurn(turn.id)} />
          ))}
        </div>
      : null}

      {turnReviewLoading ?
        <EmptyState title="Loading review" body="Reading trace-backed review evidence for the selected turn." />
      : turnReviewError ?
        <EmptyState title="Review load failed" body={turnReviewError} />
      : turnReview?.files.length ?
        <div className="detail-stack compact-stack">
          <ChangedFilePicker
            files={turnReview.files}
            testId="review-turn-file-list"
            onSelect={onSelectReviewFile}
            renderContent={(file) => (
              <FileDiffPreview
                patch={'patch' in file ? file.patch : undefined}
                diff={'diff' in file ? file.diff : undefined}
                unavailableTitle="No patch captured"
                unavailableBody="This file was changed, but the turn did not capture patch text for it."
                fallbackTitle="Raw turn patch"
              />
            )}
          />
        </div>
      : turnReview?.diffExcerpt ?
        <CodeBlock>{turnReview.diffExcerpt}</CodeBlock>
      : <EmptyState title="No captured diff" body="This selected turn did not save file-level diff evidence. Check Evidence for commands and approvals." />}
    </SideSection>
  );
}

export function ReviewEvidenceSection({ turnReview, selectedTurn }: { turnReview: ChatTurnReview | null; selectedTurn?: SessionTurn }) {
  return (
    <>
      <SideSection title="Review commands">
        <CommandList commands={turnReview?.reviewCommands ?? []} empty="No git review commands captured for this turn." />
      </SideSection>

      <SideSection title="Verification commands">
        <CommandList commands={turnReview?.verificationCommands ?? []} empty="No verification commands captured for this turn." />
      </SideSection>

      <SideSection title="Approvals and events">
        {turnReview?.approvals.length ?
          <div className="stack-list compact">
            {turnReview.approvals.map((approval, index) => (
              <div className="detail-card" key={`${approval.tool}-${approval.timestamp ?? index}`}>
                <p className="card-title">{approval.tool}</p>
                <p className="muted">{approval.command ?? 'no command details'}</p>
                <div className="pills">
                  <Pill tone={approval.approved ? 'good' : 'warn'}>{approval.approved ? 'approved' : 'rejected'}</Pill>
                </div>
                {approval.reason ? <p className="summary">{approval.reason}</p> : null}
              </div>
            ))}
          </div>
        : selectedTurn?.events.length ?
          <div className="event-list">
            {selectedTurn.events.map((event, index) => <p key={`${selectedTurn.id}-${index}`} className="event-line">{event}</p>)}
          </div>
        : <EmptyState title="No approvals or events" body="Turn-level approvals, tool review, or summarized events will appear here." />}
      </SideSection>
    </>
  );
}

export function FullDiffDialog({ diff, onClose }: { diff: ExpandedDiff | null; onClose: () => void }) {
  if (!diff) {
    return null;
  }

  return (
    <div className="diff-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="diff-dialog" role="dialog" aria-modal="true" aria-label={`${diff.subtitle}: ${diff.title}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="diff-dialog-header">
          <div className="min-w-0">
            <p className="topbar-eyebrow">Diff review</p>
            <h2>{diff.title}</h2>
            <p className="muted">{diff.subtitle}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </header>
        <div className="diff-dialog-body">
          {diff.files?.length ?
            <div className="detail-stack">
              {diff.files.map((file) => (
                <DiffViewer key={file.title} diff={file.diff} patch={file.patch} fallbackTitle={file.fallbackTitle} />
              ))}
            </div>
          : <DiffViewer diff={diff.diff} patch={diff.patch} fallbackTitle={diff.fallbackTitle} />}
        </div>
      </section>
    </div>
  );
}

function StalePatchIndicator() {
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="stale-diff-button" type="button" aria-label="Current workspace differs from captured turn">
            i
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-64">
          The selected file also has trace-backed turn evidence, but the current Git patch is different. Treat Current as live workspace state.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ChangedFilePicker({
  files,
  sourceLabel,
  testId,
  onSelect,
  renderContent,
}: {
  files: ReviewFileValue[];
  sourceLabel?: string;
  testId?: string;
  onSelect: (path: string) => void;
  renderContent?: (file: ReviewFileValue) => ReactNode;
}) {
  const [collapsedPaths, setCollapsedPaths] = useState<string[]>([]);

  useEffect(() => {
    const visiblePaths = new Set(files.map((file) => file.path));
    setCollapsedPaths((current) => current.filter((path) => visiblePaths.has(path)));
  }, [files]);

  return (
    <div className="stack-list compact" data-testid={testId}>
      {files.map((file) => {
        const expanded = !collapsedPaths.includes(file.path);
        return (
          <article key={`${'source' in file ? file.source : 'workspace'}-${file.path}`} className={className('changed-file-review-card', expanded && 'active')}>
            <button
              data-testid={`changed-file-${file.path}`}
              type="button"
              className="changed-file-review-header"
              aria-expanded={expanded}
              onClick={() => {
                onSelect(file.path);
                setCollapsedPaths((current) => (
                  current.includes(file.path)
                    ? current.filter((path) => path !== file.path)
                    : [...current, file.path]
                ));
              }}
            >
              <span className="list-button-header">
                <strong>{file.path}</strong>
                <span>{file.status}</span>
              </span>
              <span className="pills compact-pills">
                {'source' in file ? <Pill>{file.source}</Pill> : <Pill>{sourceLabel ?? 'current git'}</Pill>}
                {'additions' in file && (file.additions !== undefined || file.deletions !== undefined) ?
                  <Pill tone="good">+{file.additions ?? 0} / -{file.deletions ?? 0}</Pill>
                : null}
                {'binary' in file && file.binary ? <Pill tone="warn">binary</Pill> : null}
                {'truncated' in file && file.truncated ? <Pill tone="warn">truncated</Pill> : null}
              </span>
            </button>
            {expanded && renderContent ? <div className="changed-file-review-body">{renderContent(file)}</div> : null}
          </article>
        );
      })}
    </div>
  );
}

function FileDiffPreview({
  loading,
  error,
  diffError,
  patch,
  diff,
  unavailableTitle,
  unavailableBody,
  loadingTitle = 'Loading diff',
  loadingBody = 'Reading the selected file patch.',
  fallbackTitle,
}: {
  loading?: boolean;
  error?: string;
  diffError?: string;
  patch?: string;
  diff?: WorkspaceFileDiff['diff'];
  unavailableTitle: string;
  unavailableBody: string;
  loadingTitle?: string;
  loadingBody?: string;
  fallbackTitle: string;
}) {
  if (loading) {
    return <EmptyState title={loadingTitle} body={loadingBody} />;
  }
  if (error) {
    return <EmptyState title="File diff failed" body={error} />;
  }
  if (diffError) {
    return <EmptyState title="File diff unavailable" body={diffError} />;
  }
  if (!patch) {
    return <EmptyState title={unavailableTitle} body={unavailableBody} />;
  }

  return (
    <div className="detail-stack compact-stack">
      <DiffViewer diff={diff} patch={patch} fallbackTitle={fallbackTitle} />
    </div>
  );
}

function buildWorkspaceExpandedDiff(files: WorkspaceChangedFileValue[], diffsByPath: Record<string, WorkspaceFileDiff>): ExpandedDiff {
  return {
    title: 'Current workspace changes',
    subtitle: 'Current workspace diff',
    fallbackTitle: 'Raw workspace patch',
    files: files.flatMap((file): ExpandedDiffFile[] => {
      const fileDiff = diffsByPath[file.path];
      return fileDiff?.patch ? [{
        title: file.path,
        diff: fileDiff.diff,
        patch: fileDiff.patch,
        fallbackTitle: 'Raw workspace patch',
      }] : [];
    }),
  };
}

function buildTurnExpandedDiff(files: NonNullable<ChatTurnReview>['files']): ExpandedDiff {
  return {
    title: 'Captured turn changes',
    subtitle: 'Captured turn diff',
    fallbackTitle: 'Raw turn patch',
    files: files.flatMap((file): ExpandedDiffFile[] => file.patch ? [{
      title: file.path,
      diff: file.diff,
      patch: file.patch,
      fallbackTitle: 'Raw turn patch',
    }] : []),
  };
}
