import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';

export function WorkspaceRenameForm({
  workspaceId,
  initialName,
  disabled,
  pending,
  onRename,
}: {
  workspaceId: string;
  initialName: string;
  disabled?: boolean;
  pending?: boolean;
  onRename?: (workspaceId: string, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialName);

  useEffect(() => {
    setDraft(initialName);
  }, [initialName]);

  const changed = draft.trim() && draft.trim() !== initialName;
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!onRename || !changed) {
          return;
        }
        void onRename(workspaceId, draft.trim());
      }}
    >
      <input
        className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled}
        aria-label="Workspace name"
      />
      <Button type="submit" variant="outline" size="sm" disabled={disabled || !changed}>
        {pending ? 'Saving…' : 'Rename'}
      </Button>
    </form>
  );
}
