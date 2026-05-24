import { skipToken } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  trpcReact,
  type ControlPlaneWorkspaceChangedFile,
  type ControlPlaneWorkspaceFileDiff,
} from '@web/api/client';
import { MonacoDiffViewer } from '@web/components/diff/MonacoDiffViewer';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';

export function DiffPreview() {
  const { t } = useI18n();
  const changesQuery = trpcReact.controlPlane.workspaceChanges.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const files = useMemo(() => changesQuery.data?.files ?? [], [changesQuery.data?.files]);

  useEffect(() => {
    if (!changesQuery.data) {
      return;
    }
    setExpandedPaths(files.map((file) => file.path));
  }, [changesQuery.data, files]);

  function togglePath(path: string) {
    setExpandedPaths((current) => (
      current.includes(path)
        ? current.filter((currentPath) => currentPath !== path)
        : [...current, path]
    ));
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label={t('diffPreview.title')}>
      <header className="shrink-0 border-b border-border/70 px-3 py-2">
        <p className="v2-type-panel-title text-foreground">{t('diffPreview.title')}</p>
        <p className="v2-type-panel-subtitle text-muted-foreground">{t('diffPreview.subtitle')}</p>
      </header>

      <div className="v2-scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
        {changesQuery.isLoading ?
          <DiffPreviewEmpty title={t('diffPreview.loadingTitle')} body={t('diffPreview.loadingBody')} />
        : changesQuery.error ?
          <DiffPreviewEmpty title={t('diffPreview.failedTitle')} body={changesQuery.error.message} tone="danger" />
        : changesQuery.data?.vcs === 'none' ?
          <DiffPreviewEmpty title={t('diffPreview.noGitTitle')} body={changesQuery.data.error ?? t('diffPreview.noGitBody')} />
        : files.length ?
          <div className="grid">
            {files.map((file) => (
              <DiffPreviewFile
                key={file.path}
                expanded={expandedPaths.includes(file.path)}
                file={file}
                onToggle={() => togglePath(file.path)}
              />
            ))}
          </div>
        : <DiffPreviewEmpty title={t('diffPreview.cleanTitle')} body={t('diffPreview.cleanBody')} />}
      </div>
    </section>
  );
}

function DiffPreviewFile({
  expanded,
  file,
  onToggle,
}: {
  expanded: boolean;
  file: ControlPlaneWorkspaceChangedFile;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const fileDiffQuery = trpcReact.controlPlane.workspaceFileDiff.useQuery(
    expanded ? { path: file.path } : skipToken,
    {
      enabled: expanded,
    },
  );

  return (
    <article className={cn('v2-diff-file', expanded && 'v2-diff-file-expanded')}>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ?
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="v2-type-nav-primary block truncate text-foreground">{file.path}</span>
          {file.oldPath ? <span className="v2-type-nav-secondary block truncate text-muted-foreground">{t('diffPreview.from')} {file.oldPath}</span> : null}
        </span>
        <DiffPreviewBadge>{file.status}</DiffPreviewBadge>
        {file.additions !== undefined || file.deletions !== undefined ?
          <span className="v2-type-nav-primary inline-flex shrink-0 items-center gap-1.5" aria-label={`${file.additions ?? 0} additions, ${file.deletions ?? 0} deletions`}>
            <span className="text-emerald-200">+{file.additions ?? 0}</span>
            <span className="text-rose-300">-{file.deletions ?? 0}</span>
          </span>
        : null}
        {file.binary ? <DiffPreviewBadge tone="warn">{t('diffPreview.binary')}</DiffPreviewBadge> : null}
      </button>

      {expanded ?
        <div>
          {fileDiffQuery.isLoading ?
            <DiffPreviewEmpty title={t('diffPreview.loadingFileTitle')} body={t('diffPreview.loadingFileBody')} compact />
          : fileDiffQuery.error ?
            <DiffPreviewEmpty title={t('diffPreview.fileFailedTitle')} body={fileDiffQuery.error.message} tone="danger" compact />
          : fileDiffQuery.data?.error ?
            <DiffPreviewEmpty title={t('diffPreview.fileUnavailableTitle')} body={fileDiffQuery.data.error} compact />
          : <FileDiffContent fileDiff={fileDiffQuery.data} />}
        </div>
      : null}
    </article>
  );
}

function FileDiffContent({ fileDiff }: { fileDiff?: ControlPlaneWorkspaceFileDiff }) {
  const { t } = useI18n();

  if (!fileDiff) {
    return <DiffPreviewEmpty title={t('diffPreview.noPatchTitle')} body={t('diffPreview.noPatchBody')} compact />;
  }
  if (fileDiff.binary) {
    return <DiffPreviewEmpty title={t('diffPreview.binaryTitle')} body={t('diffPreview.binaryBody')} compact />;
  }
  if (fileDiff.diff?.hunks.length) {
    return <MonacoDiffViewer diff={fileDiff.diff} />;
  }
  if (fileDiff.patch) {
    return (
      <pre className="v2-diff-patch v2-scrollbar-hidden" data-testid="web-v2-raw-diff">
        {fileDiff.patch}
      </pre>
    );
  }

  return <DiffPreviewEmpty title={t('diffPreview.noPatchTitle')} body={t('diffPreview.noPatchBody')} compact />;
}

function DiffPreviewBadge({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <span className={cn(
      'v2-type-caption shrink-0 rounded-sm border px-1.5 py-0.5',
      tone === 'good' && 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
      tone === 'warn' && 'border-amber-300/30 bg-amber-300/10 text-amber-100',
      !tone && 'border-border/80 bg-muted/70 text-muted-foreground',
    )}>
      {children}
    </span>
  );
}

function DiffPreviewEmpty({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  compact?: boolean;
  tone?: 'danger';
}) {
  return (
    <div className={cn(
      'text-muted-foreground',
      'px-3 py-4',
      tone === 'danger' && 'text-destructive',
    )}>
      <p className="v2-type-body-strong text-foreground">{title}</p>
      <p className="v2-type-panel-subtitle mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}
