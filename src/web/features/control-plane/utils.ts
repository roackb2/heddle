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

function readNumericField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
