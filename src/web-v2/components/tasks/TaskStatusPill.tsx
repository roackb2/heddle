import type { ControlPlaneHeartbeatTaskView } from '@web/api/client';
import { cn } from '@web/lib/utils';
import { TASK_STATUS_TONE } from './task-format';

interface TaskStatusPillProps {
  status: ControlPlaneHeartbeatTaskView['status'];
}

const toneClasses = {
  active: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  danger: 'border-red-400/30 bg-red-400/10 text-red-200',
  muted: 'border-border bg-muted/30 text-muted-foreground',
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
} satisfies Record<(typeof TASK_STATUS_TONE)[keyof typeof TASK_STATUS_TONE], string>;

export function TaskStatusPill({ status }: TaskStatusPillProps) {
  return (
    <span className={cn('v2-type-caption shrink-0 rounded-sm border px-1.5 py-0.5 tabular-nums', toneClasses[TASK_STATUS_TONE[status]])}>
      {status}
    </span>
  );
}
