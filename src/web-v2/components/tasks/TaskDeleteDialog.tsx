import type { ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { Button } from '@web/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import { useI18n } from '@web/i18n';
import { taskDisplayName } from './task-format';

interface TaskDeleteDialogProps {
  error?: string;
  open: boolean;
  submitting: boolean;
  task?: ControlPlaneHeartbeatTaskView;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function TaskDeleteDialog({
  error,
  open,
  submitting,
  task,
  onOpenChange,
  onConfirm,
}: TaskDeleteDialogProps) {
  const { t } = useI18n();

  function updateOpen(nextOpen: boolean) {
    if (!submitting) {
      onOpenChange(nextOpen);
    }
  }

  return (
    <Dialog open={open} onOpenChange={updateOpen}>
      <DialogContent className="v2-task-create-dialog">
        <DialogHeader>
          <DialogTitle>{t('tasks.delete.title')}</DialogTitle>
          <DialogDescription>{t('tasks.delete.description')}</DialogDescription>
        </DialogHeader>

        {task ? (
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <p className="v2-type-body-strong truncate text-foreground">{taskDisplayName(task)}</p>
            <p className="v2-type-caption mt-1 line-clamp-2 text-muted-foreground">{task.task}</p>
          </div>
        ) : null}

        {error ? <p className="v2-type-caption text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={submitting} onClick={() => updateOpen(false)}>
            {t('tasks.delete.cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={submitting || !task} onClick={() => void onConfirm()}>
            {t('tasks.delete.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
