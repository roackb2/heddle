import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';

dayjs.extend(duration);

const DURATION_UNITS = {
  ms: 'millisecond',
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
} as const;

export function parseDurationMs(raw: string): number {
  const match = raw.trim().match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) {
    throw new Error(`Invalid duration: ${raw}`);
  }

  const value = Number.parseInt(match[1] ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid duration: ${raw}`);
  }

  const unit = parseDurationUnit(match[2]);
  return dayjs.duration(value, DURATION_UNITS[unit]).asMilliseconds();
}

export function formatDurationMs(value: number): string {
  const interval = dayjs.duration(value);
  const units = [
    ['day', 'd'],
    ['hour', 'h'],
    ['minute', 'm'],
    ['second', 's'],
  ] as const;
  const readable = units.find(([unit]) => value % dayjs.duration(1, unit).asMilliseconds() === 0);
  if (readable) {
    const [unit, suffix] = readable;
    return `${interval.as(unit)}${suffix}`;
  }
  return `${value}ms`;
}

function parseDurationUnit(value: string | undefined): keyof typeof DURATION_UNITS {
  if (!value || value in DURATION_UNITS) {
    return (value ?? 'ms') as keyof typeof DURATION_UNITS;
  }
  throw new Error(`Invalid duration unit: ${value}`);
}
