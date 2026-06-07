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
    ]);
  });

  it('executes aliases without falling through to control-plane slash commands', () => {
    const activity = vi.fn();
    const diff = vi.fn();
    const commandResults = vi.fn();

    expect(TuiLocalSlashCommandService.execute('/a', { activity, diff, commandResults })).toBe(true);
    expect(TuiLocalSlashCommandService.execute('/DIFF', { activity, diff, commandResults })).toBe(true);
    expect(TuiLocalSlashCommandService.execute(' /commands ', { activity, diff, commandResults })).toBe(true);
    expect(TuiLocalSlashCommandService.execute('/model', { activity, diff, commandResults })).toBe(false);

    expect(activity).toHaveBeenCalledTimes(1);
    expect(diff).toHaveBeenCalledTimes(1);
    expect(commandResults).toHaveBeenCalledTimes(1);
  });
});
