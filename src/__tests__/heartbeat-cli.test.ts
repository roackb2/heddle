import { describe, expect, it } from 'vitest';
import { formatDurationMs, parseDurationMs, parseHeartbeatArgs } from '../cli/heartbeat.js';

describe('heartbeat CLI helpers', () => {
  it('parses heartbeat subcommands and flags', () => {
    expect(parseHeartbeatArgs([
      'task',
      'add',
      '--id',
      'repo-gardener',
      '--task=Maintain the repo',
      '--every',
      '15m',
      '--disabled',
    ])).toEqual({
      command: 'task',
      subcommand: 'add',
      rest: [],
      flags: {
        id: 'repo-gardener',
        task: 'Maintain the repo',
        every: '15m',
        disabled: true,
      },
    });
  });

  it('parses the convenience heartbeat start command', () => {
    expect(parseHeartbeatArgs([
      'start',
      '--every',
      '10m',
      '--task',
      'Watch the repo',
      '--once',
    ])).toEqual({
      command: 'start',
      subcommand: undefined,
      rest: [],
      flags: {
        every: '10m',
        task: 'Watch the repo',
        once: true,
      },
    });
  });

  it('parses and formats scheduler durations', () => {
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('2h')).toBe(2 * 60 * 60_000);
    expect(parseDurationMs('1d')).toBe(24 * 60 * 60_000);

    expect(formatDurationMs(500)).toBe('500ms');
    expect(formatDurationMs(30_000)).toBe('30s');
    expect(formatDurationMs(15 * 60_000)).toBe('15m');
    expect(formatDurationMs(2 * 60 * 60_000)).toBe('2h');
    expect(formatDurationMs(24 * 60 * 60_000)).toBe('1d');
  });

  it('rejects invalid scheduler durations', () => {
    expect(() => parseDurationMs('soon')).toThrow('Invalid duration');
    expect(() => parseDurationMs('0s')).toThrow('Invalid duration');
  });
});
