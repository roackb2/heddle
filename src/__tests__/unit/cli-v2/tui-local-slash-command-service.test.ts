import { describe, expect, it, vi } from 'vitest';
import { TuiLocalSlashCommandService } from '@/cli-v2/services/slash-commands/index.js';

describe('TuiLocalSlashCommandService', () => {
  it('exposes terminal presentation commands consistently', () => {
    expect(TuiLocalSlashCommandService.hints()).toEqual([
      { command: '/a', description: 'toggle terminal activity details' },
      { command: '/activity', description: 'toggle terminal activity details' },
      { command: '/d', description: 'open terminal diff review' },
      { command: '/diff', description: 'open terminal diff review' },
      { command: '/c', description: 'toggle terminal command output' },
      { command: '/commands', description: 'toggle terminal command output' },
      { command: '/subagents', description: 'show the local subagent preference' },
      { command: '/subagents on', description: 'allow read-only subagents for upcoming messages' },
      { command: '/subagents off', description: 'disable subagents for upcoming messages' },
    ]);
  });

  it('executes aliases without falling through to control-plane slash commands', () => {
    const activity = vi.fn();
    const diff = vi.fn();
    const commandResults = vi.fn();
    const subagentsStatus = vi.fn();
    const subagentsOn = vi.fn();
    const subagentsOff = vi.fn();
    const handlers = { activity, diff, commandResults, subagentsStatus, subagentsOn, subagentsOff };

    expect(TuiLocalSlashCommandService.execute('/a', handlers)).toBe(true);
    expect(TuiLocalSlashCommandService.execute('/DIFF', handlers)).toBe(true);
    expect(TuiLocalSlashCommandService.execute(' /commands ', handlers)).toBe(true);
    expect(TuiLocalSlashCommandService.execute('/SUBAGENTS OFF', handlers)).toBe(true);
    expect(TuiLocalSlashCommandService.execute('/model', handlers)).toBe(false);
    expect(TuiLocalSlashCommandService.execute('/permissions set', handlers)).toBe(false);
    expect(TuiLocalSlashCommandService.execute('/permissions auto', handlers)).toBe(false);

    expect(activity).toHaveBeenCalledTimes(1);
    expect(diff).toHaveBeenCalledTimes(1);
    expect(commandResults).toHaveBeenCalledTimes(1);
    expect(subagentsOff).toHaveBeenCalledTimes(1);
  });
});
