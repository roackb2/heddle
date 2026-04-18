export function parseDurationMs(raw: string): number {
  const match = raw.trim().match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) {
    throw new Error(`Invalid duration: ${raw}`);
  }

  const value = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid duration: ${raw}`);
  }

  const unit = match[2] ?? 'ms';
  const multiplier =
    unit === 'ms' ? 1
    : unit === 's' ? 1_000
    : unit === 'm' ? 60_000
    : unit === 'h' ? 60 * 60_000
    : 24 * 60 * 60_000;
  return value * multiplier;
}

export function formatDurationMs(value: number): string {
  if (value % (24 * 60 * 60_000) === 0) {
    return `${value / (24 * 60 * 60_000)}d`;
  }
  if (value % (60 * 60_000) === 0) {
    return `${value / (60 * 60_000)}h`;
  }
  if (value % 60_000 === 0) {
    return `${value / 60_000}m`;
  }
  if (value % 1_000 === 0) {
    return `${value / 1_000}s`;
  }
  return `${value}ms`;
}
