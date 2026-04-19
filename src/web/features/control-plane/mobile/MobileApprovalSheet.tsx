import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';

type MobileApproval = {
  tool: string;
  callId: string;
  input?: unknown;
  requestedAt: string;
};

type MobileApprovalSheetProps = {
  approval: MobileApproval | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: (approved: boolean) => void;
};

const HIGH_RISK_TOOLS = new Set([
  'run_shell_mutate',
  'edit_file',
  'write_to_file',
  'delete_file',
  'apply_patch',
]);

export function MobileApprovalSheet({ approval, open, onOpenChange, onResolve }: MobileApprovalSheetProps) {
  if (!approval || !open) {
    return null;
  }

  const risk = HIGH_RISK_TOOLS.has(approval.tool) ? 'high' : 'medium';
  const pathSummary = summarizePath(approval.input);
  const commandSummary = summarizeCommand(approval.input);
  const rawPayload = formatPayload(approval.input);

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="Pending approval details">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Close approval details"
        onClick={() => onOpenChange(false)}
      />

      <section className="relative z-10 flex max-h-[82dvh] w-full flex-col rounded-t-2xl border border-border bg-card">
        <header className="shrink-0 border-b border-border px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold">Approval required: {approval.tool}</p>
              <p className="m-0 mt-1 truncate text-xs text-muted-foreground">Call ID: {approval.callId}</p>
              <p className="m-0 mt-1 truncate text-xs text-muted-foreground">Requested: {new Date(approval.requestedAt).toLocaleString()}</p>
            </div>
            <Badge variant={risk === 'high' ? 'destructive' : 'secondary'}>{risk} risk</Badge>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <dl className="grid gap-2 text-xs">
            <div className="rounded-md border border-border bg-background px-2 py-2">
              <dt className="font-medium text-foreground">Path target</dt>
              <dd className="m-0 mt-1 break-all text-muted-foreground">{pathSummary ?? 'No explicit path in payload'}</dd>
            </div>
            <div className="rounded-md border border-border bg-background px-2 py-2">
              <dt className="font-medium text-foreground">Command target</dt>
              <dd className="m-0 mt-1 break-all text-muted-foreground">{commandSummary ?? 'No explicit command in payload'}</dd>
            </div>
          </dl>

          <div className="mt-3 rounded-md border border-border bg-background">
            <div className="border-b border-border px-2 py-2 text-xs font-medium">Raw payload</div>
            <pre className="m-0 max-h-[34dvh] overflow-auto whitespace-pre-wrap break-words px-2 py-2 text-[11px] leading-4 text-muted-foreground">
              {rawPayload}
            </pre>
          </div>
        </div>

        <footer className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-card px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" className="h-11" onClick={() => onResolve(true)}>
              Approve
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={() => onResolve(false)}>
              Deny
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function summarizePath(input: unknown): string | undefined {
  const value = pickField(input, ['targetFile', 'file_path', 'filePath', 'path', 'paths', 'absolute_path']);
  if (!value) {
    return undefined;
  }
  return value;
}

function summarizeCommand(input: unknown): string | undefined {
  return pickField(input, ['command', 'CommandLine', 'cmd']);
}

function pickField(input: unknown, candidates: string[]): string | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  for (const key of candidates) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const stringValues = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
      if (stringValues.length > 0) {
        return stringValues.slice(0, 3).join(', ');
      }
    }
  }

  return undefined;
}

function formatPayload(input: unknown): string {
  if (typeof input === 'undefined') {
    return 'No payload provided.';
  }

  try {
    return JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    return String(input);
  }
}
