import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTuiFrameRecorder } from '../../../cli/chat/debug/tui-frame-recorder.js';

describe('createTuiFrameRecorder', () => {
  it('writes stripped text, raw ansi, and metadata snapshots', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-tui-snapshot-'));
    const recorder = createTuiFrameRecorder(stateRoot);

    recorder.record('\u001B[2J\u001B[0;0HHeader\r\nStatus: \u001B[32mCompacting\u001B[39m\r\n');
    const saved = recorder.saveSnapshot({
      sessionId: 'session-123',
      model: 'gpt-5.1-codex-mini',
      status: 'compacting',
      terminalColumns: 80,
      terminalRows: 24,
    });

    const textOutput = readFileSync(saved.txtPath, 'utf8');
    const ansiOutput = readFileSync(saved.ansiPath, 'utf8');
    const metadata = JSON.parse(readFileSync(saved.jsonPath, 'utf8')) as {
      sessionId: string;
      model: string;
      status: string;
      terminalColumns: number;
      terminalRows: number;
      txtPath: string;
      ansiPath: string;
    };

    expect(textOutput).toContain('Header');
    expect(textOutput).toContain('Status: Compacting');
    expect(textOutput).not.toContain('\u001B[');
    expect(ansiOutput).toContain('\u001B[32mCompacting\u001B[39m');
    expect(metadata).toMatchObject({
      sessionId: 'session-123',
      model: 'gpt-5.1-codex-mini',
      status: 'compacting',
      terminalColumns: 80,
      terminalRows: 24,
      txtPath: saved.txtPath,
      ansiPath: saved.ansiPath,
    });
  });

  it('falls back to the buffered stream when the latest chunk is only terminal control output', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-tui-snapshot-tail-'));
    const recorder = createTuiFrameRecorder(stateRoot);

    recorder.record('\u001B[2J\u001B[0;0HVisible frame\r\nStatus: Idle\r\n');
    recorder.record('\u001B[?2026l');
    const saved = recorder.saveSnapshot();

    const textOutput = readFileSync(saved.txtPath, 'utf8');
    const ansiOutput = readFileSync(saved.ansiPath, 'utf8');

    expect(textOutput).toContain('Visible frame');
    expect(textOutput).toContain('Status: Idle');
    expect(ansiOutput).toContain('Visible frame');
  });

  it('uses an explicit text snapshot when provided', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-tui-snapshot-explicit-'));
    const recorder = createTuiFrameRecorder(stateRoot);

    recorder.record('\u001B[2J\u001B[0;0HNoisy terminal frame\r\n');
    const saved = recorder.saveSnapshot({
      textSnapshot: 'Clean snapshot\nstatus=compacting\n',
    });

    const textOutput = readFileSync(saved.txtPath, 'utf8');
    const ansiOutput = readFileSync(saved.ansiPath, 'utf8');

    expect(textOutput).toBe('Clean snapshot\nstatus=compacting\n');
    expect(ansiOutput).toContain('Noisy terminal frame');
  });
});
