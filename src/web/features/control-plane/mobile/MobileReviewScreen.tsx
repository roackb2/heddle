import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { ChatSessionDetail, ChatTurnReview, ControlPlaneState, WorkspaceChanges, WorkspaceFileDiff } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';
import { formatDate } from '../utils';
import { MobileSessionNav } from './MobileSessionNav';
import { Button } from '../../../components/ui/button';
import { DiffViewer } from '../components/DiffViewer';
import type { ExpandedDiff } from '../screens/SessionsScreen';

type SessionTurn = Exclude<ChatSessionDetail, null>['turns'][number];

type MobileReviewScreenProps = {
  activeSession?: ControlPlaneState['sessions'][number];
  sessionDetail: ChatSessionDetail | null;
  selectedTurnId?: string;
  selectedTurn?: SessionTurn;
  turnReview: ChatTurnReview | null;
  turnReviewLoading: boolean;
  turnReviewError?: string;
  workspaceChanges: WorkspaceChanges | null;
  workspaceChangesLoading: boolean;
  workspaceChangesError?: string;
  selectedWorkspaceFile?: WorkspaceChanges['files'][number];
  workspaceFileDiff: WorkspaceFileDiff | null;
  workspaceFileDiffLoading: boolean;
  workspaceFileDiffError?: string;
  onSelectWorkspaceFile: (path: string) => void;
  onRefreshWorkspaceReview: () => void;
  selectedTurnPatchIsStale: boolean;
  onOpenDiff: (diff: ExpandedDiff) => void;
  onBackToSessions: () => void;
  onOpenChat: () => void;
  onSelectTurn: (turnId: string) => void;
};

type ReviewTab = 'current' | 'turn' | 'evidence';

export function MobileReviewScreen({
  activeSession,
  sessionDetail,
  selectedTurnId,
  selectedTurn,
  turnReview,
  turnReviewLoading,
  turnReviewError,
  workspaceChanges,
  workspaceChangesLoading,
  workspaceChangesError,
  selectedWorkspaceFile,
  workspaceFileDiff,
  workspaceFileDiffLoading,
  workspaceFileDiffError,
  onSelectWorkspaceFile,
  onRefreshWorkspaceReview,
  selectedTurnPatchIsStale,
  onOpenDiff,
  onBackToSessions,
  onOpenChat,
  onSelectTurn,
}: MobileReviewScreenProps) {
  const [reviewTab, setReviewTab] = useState<ReviewTab>('current');
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();

  const title = sessionDetail?.name ?? activeSession?.name ?? 'Session';
  const subtitle = 'Review evidence';
  const selectedFile =
    turnReview?.files.find((file) => file.path === selectedFilePath) ?? turnReview?.files[0];

  useEffect(() => {
    setSelectedFilePath(turnReview?.files[0]?.path);
  }, [selectedTurnId, turnReview?.traceFile]);

  const commandGroups = useMemo(() => {
    if (!turnReview) {
      return [] as Array<{ label: string; commands: Exclude<ChatTurnReview, null>['reviewCommands'] }>;
    }

    return [
      { label: 'Review', commands: turnReview.reviewCommands },
      { label: 'Verification', commands: turnReview.verificationCommands },
      { label: 'Mutation', commands: turnReview.mutationCommands },
    ];
  }, [turnReview]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <MobileSessionNav
        activeView="review"
        title={title}
        subtitle={activeSession ? `${subtitle} · updated ${formatDate(activeSession.updatedAt)}` : subtitle}
        onBackToSessions={onBackToSessions}
        onOpenChat={onOpenChat}
        onOpenReview={() => undefined}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-3">
            <nav className="grid grid-cols-3 rounded-md bg-muted p-1" aria-label="Review evidence tabs">
              <ReviewTabButton active={reviewTab === 'current'} onClick={() => setReviewTab('current')}>Current</ReviewTabButton>
              <ReviewTabButton active={reviewTab === 'turn'} onClick={() => setReviewTab('turn')}>Turn</ReviewTabButton>
              <ReviewTabButton active={reviewTab === 'evidence'} onClick={() => setReviewTab('evidence')}>Evidence</ReviewTabButton>
            </nav>

            {reviewTab === 'current' ?
              <MobileCard
                title="Current workspace changes"
                actions={
                  <div className="flex items-center gap-2">
                    {selectedTurnPatchIsStale ? <Badge variant="outline">live diff differs</Badge> : null}
                    <Button type="button" variant="outline" size="sm" onClick={onRefreshWorkspaceReview} disabled={workspaceChangesLoading || workspaceFileDiffLoading}>Refresh</Button>
                  </div>
                }
              >
                {workspaceChangesLoading ?
                  <MobileEmptyState title="Loading workspace diff" body="Reading current Git changes from the active workspace." />
                : workspaceChangesError ?
                  <MobileEmptyState title="Workspace diff failed" body={workspaceChangesError} />
                : workspaceChanges?.vcs === 'none' ?
                  <MobileEmptyState title="Not a git workspace" body={workspaceChanges.error ?? 'Current workspace changes require a Git-backed project.'} />
                : workspaceChanges?.files.length ?
                  <div className="space-y-2">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {workspaceChanges.files.map((file) => (
                        <button
                          key={`workspace-${file.path}`}
                          type="button"
                          className={`shrink-0 rounded-md border px-2 py-1 text-left text-[11px] ${selectedWorkspaceFile?.path === file.path ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                          onClick={() => onSelectWorkspaceFile(file.path)}
                        >
                          <span className="block max-w-44 truncate font-medium">{file.path}</span>
                          <span className="block">{file.status}{file.additions !== undefined || file.deletions !== undefined ? ` · +${file.additions ?? 0} / -${file.deletions ?? 0}` : ''}</span>
                        </button>
                      ))}
                    </div>
                    {workspaceFileDiffLoading ?
                      <MobileEmptyState title="Loading file diff" body="Reading the selected file patch." />
                    : workspaceFileDiffError ?
                      <MobileEmptyState title="File diff failed" body={workspaceFileDiffError} />
                    : workspaceFileDiff?.error ?
                      <MobileEmptyState title="File diff unavailable" body={workspaceFileDiff.error} />
                    : workspaceFileDiff?.patch ?
                      <div className="space-y-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenDiff({
                            title: selectedWorkspaceFile?.path ?? workspaceFileDiff.path,
                            subtitle: 'Current workspace diff',
                            diff: workspaceFileDiff.diff,
                            patch: workspaceFileDiff.patch,
                            fallbackTitle: 'Raw workspace patch',
                          })}
                        >
                          Open full diff
                        </Button>
                        <DiffViewer diff={workspaceFileDiff.diff} patch={workspaceFileDiff.patch} fallbackTitle="Raw workspace patch" />
                      </div>
                    : <MobileEmptyState title="No patch available" body="Git reports this file as changed, but no patch text is available for it." />}
                  </div>
                : <MobileEmptyState title="Clean workspace" body="Git does not report current project file changes." />}
              </MobileCard>
            : reviewTab === 'evidence' ?
              <div className="space-y-3">
                {turnReviewLoading ?
                  <MobileEmptyState title="Loading review" body="Reading trace-backed review evidence for the selected turn." />
                : turnReviewError ?
                  <MobileEmptyState title="Review load failed" body={turnReviewError} />
                : <>
                    {commandGroups.map((group) => (
                      <MobileCommandGroup key={group.label} label={group.label} commands={group.commands} />
                    ))}
                    <MobileApprovalEvents turnReview={turnReview} selectedTurn={selectedTurn} />
                  </>}
              </div>
            : <MobileCard title="Captured turn diff">
                {sessionDetail?.turns.length ?
                  <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                    {[...sessionDetail.turns].reverse().map((turn) => (
                      <button
                        key={turn.id}
                        type="button"
                        className={`shrink-0 rounded-md border px-2 py-1 text-left text-[11px] ${turn.id === selectedTurnId ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                        onClick={() => onSelectTurn(turn.id)}
                      >
                        <span className="block max-w-44 truncate font-medium">{turn.prompt}</span>
                        <span className="block">{turn.outcome} · {turn.steps} steps</span>
                      </button>
                    ))}
                  </div>
                : null}
                {turnReviewLoading ?
                  <MobileEmptyState title="Loading review" body="Reading trace-backed review evidence for the selected turn." />
                : turnReviewError ?
                  <MobileEmptyState title="Review load failed" body={turnReviewError} />
                : turnReview?.files.length ?
                  <div className="space-y-2">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {turnReview.files.map((file) => (
                        <button
                          key={`${file.source}-${file.path}`}
                          type="button"
                          className={`shrink-0 rounded-md border px-2 py-1 text-left text-[11px] ${selectedFile?.path === file.path ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                          onClick={() => setSelectedFilePath(file.path)}
                        >
                          <span className="block max-w-44 truncate font-medium">{file.path}</span>
                          <span className="block">{file.status} · {file.source}{file.truncated ? ' · truncated' : ''}</span>
                        </button>
                      ))}
                    </div>
                    {selectedFile?.patch ?
                      <div className="space-y-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onOpenDiff({
                            title: selectedFile.path,
                            subtitle: 'Captured turn diff',
                            diff: selectedFile.diff,
                            patch: selectedFile.patch,
                            fallbackTitle: 'Raw turn patch',
                          })}
                        >
                          Open full diff
                        </Button>
                        <DiffViewer diff={selectedFile.diff} patch={selectedFile.patch} fallbackTitle="Raw turn patch" />
                      </div>
                    : <MobileEmptyState title="No patch captured" body="This file was changed, but the turn did not capture patch text for it." />}
                  </div>
                : turnReview?.diffExcerpt ?
                  <pre className="max-h-[52dvh] overflow-auto rounded-md border border-border bg-background p-2 text-[11px] leading-4 text-muted-foreground">{turnReview.diffExcerpt}</pre>
                : <MobileEmptyState title="No changed files" body="This turn did not capture structured file review data." />}
              </MobileCard>}
          </div>
      </div>
    </section>
  );
}

function MobileCard({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
        {actions}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function MobileCommandGroup({
  label,
  commands,
}: {
  label: string;
  commands: Exclude<ChatTurnReview, null>['reviewCommands'];
}) {
  return (
    <MobileCard title={`${label} commands`}>
      {commands.length ?
        <div className="space-y-2">
          {commands.map((command) => (
            <div key={`${label}-${command.tool}-${command.command}`} className="rounded-md border border-border bg-background px-2 py-2">
              <p className="m-0 break-words text-xs font-medium text-foreground">{command.command}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="outline">{command.tool}</Badge>
                <Badge variant={command.exitCode === 0 ? 'secondary' : 'outline'}>exit {command.exitCode ?? 'n/a'}</Badge>
              </div>
              {command.stdout ? <pre className="mt-2 max-h-36 overflow-auto rounded border border-border bg-card p-2 text-[11px] leading-4 text-muted-foreground">{command.stdout}</pre> : null}
              {command.stderr ? <pre className="mt-2 max-h-36 overflow-auto rounded border border-border bg-card p-2 text-[11px] leading-4 text-destructive">{command.stderr}</pre> : null}
            </div>
          ))}
        </div>
      : <MobileEmptyState title="No commands" body={`No ${label.toLowerCase()} commands captured for this turn.`} />}
    </MobileCard>
  );
}

function MobileApprovalEvents({ turnReview, selectedTurn }: { turnReview: ChatTurnReview | null; selectedTurn?: SessionTurn }) {
  return (
    <MobileCard title="Approvals and events">
      {turnReview?.approvals.length ?
        <div className="space-y-2">
          {turnReview.approvals.map((approval, index) => (
            <div key={`${approval.tool}-${approval.timestamp ?? index}`} className="rounded-md border border-border bg-background px-2 py-2">
              <p className="m-0 text-xs font-medium text-foreground">{approval.tool}</p>
              <p className="m-0 mt-1 break-words text-[11px] text-muted-foreground">{approval.command ?? 'no command details'}</p>
              <div className="mt-1">
                <Badge variant={approval.approved ? 'secondary' : 'destructive'}>{approval.approved ? 'approved' : 'rejected'}</Badge>
              </div>
              {approval.reason ? <p className="m-0 mt-1 text-[11px] text-muted-foreground">{approval.reason}</p> : null}
            </div>
          ))}
        </div>
      : selectedTurn?.events.length ?
        <div className="space-y-1">
          {selectedTurn.events.map((event, index) => (
            <p key={`${selectedTurn.id}-${index}`} className="m-0 rounded-md border border-border bg-background px-2 py-2 text-[11px] text-muted-foreground">{event}</p>
          ))}
        </div>
      : <MobileEmptyState title="No approvals or events" body="Turn-level approvals and events will appear here." />}
    </MobileCard>
  );
}

function ReviewTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`h-8 rounded-md text-[11px] font-medium ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MobileEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-3">
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      <p className="m-0 mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
