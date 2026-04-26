import { CodeBlock, EmptyState, Pill } from './common';
import { className } from '../utils';
import type { RouterOutputs } from '../../../lib/api';

type ReviewDiffFile = NonNullable<RouterOutputs['controlPlane']['workspaceFileDiff']['diff']>;

export function DiffViewer({
  diff,
  patch,
  fallbackTitle = 'Raw patch',
}: {
  diff?: ReviewDiffFile;
  patch?: string;
  fallbackTitle?: string;
}) {
  if (diff?.binary) {
    return <EmptyState title="Binary file" body="Git reports this as a binary diff, so Heddle cannot render line-level changes." />;
  }

  if (diff?.hunks.length) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-background font-mono text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2 font-sans">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{diff.path}</p>
            {diff.oldPath ? <p className="truncate text-xs text-muted-foreground">from {diff.oldPath}</p> : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Pill>{diff.status}</Pill>
            <Pill tone="good">+{diff.additions} / -{diff.deletions}</Pill>
          </div>
        </div>
        <div className="max-h-[44rem] overflow-auto">
          {diff.hunks.map((hunk, hunkIndex) => (
            <table key={`${hunk.header}-${hunkIndex}`} className="w-full border-collapse">
              <tbody>
                <tr>
                  <td colSpan={3} className="border-y border-border bg-muted/40 px-3 py-1 font-mono text-[11px] text-muted-foreground">
                    {hunk.header}
                  </td>
                </tr>
                {hunk.lines.map((line, lineIndex) => (
                  <tr
                    key={`${hunk.header}-${line.oldLineNumber ?? ''}-${line.newLineNumber ?? ''}-${lineIndex}`}
                    className={className(
                      line.type === 'added' && 'bg-emerald-500/10',
                      line.type === 'deleted' && 'bg-rose-500/10',
                    )}
                  >
                    <td className="w-12 select-none border-r border-border px-2 py-0.5 text-right text-muted-foreground/70">
                      {line.oldLineNumber ?? ''}
                    </td>
                    <td className="w-12 select-none border-r border-border px-2 py-0.5 text-right text-muted-foreground/70">
                      {line.newLineNumber ?? ''}
                    </td>
                    <td className="whitespace-pre px-3 py-0.5 text-foreground">
                      {line.content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </div>
    );
  }

  if (patch) {
    return (
      <div className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Pill tone="warn">{fallbackTitle}</Pill>
          <span className="min-w-0 text-xs text-muted-foreground">Structured hunks are unavailable for this patch.</span>
        </div>
        <CodeBlock>{patch}</CodeBlock>
      </div>
    );
  }

  return <EmptyState title="No patch available" body="Git reports this file as changed, but no patch text is available for it." />;
}
