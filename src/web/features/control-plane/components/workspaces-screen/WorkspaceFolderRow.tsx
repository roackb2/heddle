import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import type { WorkspaceDirectoryListing } from '../../../../lib/api';

export function WorkspaceFolderRow({
  label,
  detail,
  entry,
  onOpen,
  onSelect,
}: {
  label: string;
  detail: string;
  entry?: WorkspaceDirectoryListing['entries'][number];
  onOpen: () => void;
  onSelect?: () => void;
}) {
  return (
    <div className="grid gap-3 border-b border-border p-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <button type="button" className="min-w-0 text-left" onClick={onOpen}>
        <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span>
        {entry ?
          <span className="mt-2 flex flex-wrap gap-1">
            {entry.hasHeddleState ? <Badge variant="secondary">Heddle workspace</Badge> : null}
            {entry.hasGit ? <Badge variant="outline">git repo</Badge> : null}
            {entry.hasPackageJson ? <Badge variant="outline">package.json</Badge> : null}
          </span>
        : null}
      </button>
      <div className="flex gap-2 sm:justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}>Open</Button>
        {onSelect ?
          <Button type="button" variant="outline" size="sm" onClick={onSelect}>Select</Button>
        : null}
      </div>
    </div>
  );
}
