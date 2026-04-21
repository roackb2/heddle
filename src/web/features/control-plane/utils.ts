export function className(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function toneFor(value: string | undefined): 'good' | 'warn' | 'bad' | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'complete' || value === 'continue' || value === 'done' || value === 'idle' || value === 'enabled') {
    return 'good';
  }
  if (value === 'blocked' || value === 'escalate' || value === 'waiting' || value === 'paused') {
    return 'warn';
  }
  if (value === 'failed' || value === 'error') {
    return 'bad';
  }
  return undefined;
}

export function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : 'none';
}

export function formatShortDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export function short(value: string, length = 220): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function shortPath(value: string): string {
  const parts = value.split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}

export function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

export function formatInterval(intervalMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(intervalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatUsage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const input = readNumericField(usage, ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens']);
  const output = readNumericField(usage, ['outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens']);
  const total = readNumericField(usage, ['totalTokens', 'total_tokens']);
  const parts = [
    input !== undefined ? `in ${input.toLocaleString()}` : undefined,
    output !== undefined ? `out ${output.toLocaleString()}` : undefined,
    total !== undefined ? `total ${total.toLocaleString()}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' • ') : undefined;
}

export function describeHeartbeatExecution(task: {
  status?: string;
  enabled: boolean;
  nextRunAt?: string;
}): { label: string; tone: 'good' | 'warn' | 'bad' | undefined; detail: string } {
  if (task.status === 'running') {
    return {
      label: 'running now',
      tone: 'good',
      detail: 'The task is actively executing a heartbeat wake cycle.',
    };
  }

  if (!task.enabled) {
    return {
      label: 'paused',
      tone: 'warn',
      detail: 'The task is disabled and will not run until resumed.',
    };
  }

  if (task.status === 'complete') {
    return {
      label: 'finished',
      tone: 'good',
      detail: 'The task reached a terminal complete decision and stopped scheduling.',
    };
  }

  if (task.status === 'blocked') {
    return {
      label: 'blocked',
      tone: 'warn',
      detail: 'The task escalated and is waiting for human follow-up.',
    };
  }

  if (task.status === 'failed') {
    return {
      label: 'failed',
      tone: 'bad',
      detail: 'The last wake failed. It will retry according to the next run schedule.',
    };
  }

  if (task.status === 'waiting') {
    const nextRunAt = task.nextRunAt ? Date.parse(task.nextRunAt) : Number.NaN;
    if (Number.isFinite(nextRunAt) && nextRunAt <= Date.now() + 1_000) {
      return {
        label: 'queued',
        tone: 'warn',
        detail: 'The task is queued and will start on the next worker poll.',
      };
    }

    return {
      label: 'scheduled',
      tone: 'good',
      detail: 'The task is waiting for its next scheduled wake time.',
    };
  }

  return {
    label: task.status ?? 'idle',
    tone: toneFor(task.status),
    detail: 'The task is currently idle.',
  };
}

function readNumericField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
