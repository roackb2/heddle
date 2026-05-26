import { DiffPreview } from '@web/components/diff/DiffPreview';

export function ContextInspector({ workspaceId }: { workspaceId?: string }) {
  return <DiffPreview workspaceId={workspaceId} />;
}
