import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveControlPlaneLayoutSnapshot } from '../../../server/features/control-plane/services/layout-snapshots.js';

describe('control-plane layout snapshots', () => {
  it('persists snapshot JSON under the debug snapshot directory', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-layout-snapshot-'));

    const saved = await saveControlPlaneLayoutSnapshot(stateRoot, {
      version: 1,
      capturedAt: '2026-04-19T02:16:00.000Z',
      appState: {
        activeTab: 'sessions',
        selectedSessionId: 'session-1',
      },
      screenshot: {
        status: 'unavailable',
        reason: 'not requested',
      },
    });

    expect(saved.jsonPath).toContain(join(stateRoot, 'debug', 'dom-snapshots'));
    expect(saved.jsonPath).toContain('sessions-session-1');
    expect(existsSync(saved.jsonPath)).toBe(true);
    expect(JSON.parse(readFileSync(saved.jsonPath, 'utf8'))).toEqual(expect.objectContaining({
      version: 1,
      appState: expect.objectContaining({ activeTab: 'sessions' }),
    }));
  });

  it('extracts PNG screenshot data into a paired file', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-layout-snapshot-'));
    const pngDataUrl = `data:image/png;base64,${Buffer.from('fake-png').toString('base64')}`;

    const saved = await saveControlPlaneLayoutSnapshot(stateRoot, {
      capturedAt: '2026-04-19T02:16:00.000Z',
      appState: {
        activeTab: 'sessions',
        pendingApproval: {
          tool: 'edit_file',
        },
      },
      screenshot: {
        status: 'captured',
        kind: 'screen-capture-frame',
        dataUrl: pngDataUrl,
        width: 390,
        height: 844,
      },
    });

    expect(saved.screenshotPath).toBeDefined();
    expect(existsSync(saved.jsonPath)).toBe(true);
    expect(existsSync(saved.screenshotPath ?? '')).toBe(true);
    const storedSnapshot = JSON.parse(readFileSync(saved.jsonPath, 'utf8')) as {
      screenshot?: { dataUrl?: string; path?: string };
    };
    expect(storedSnapshot.screenshot?.dataUrl).toBeUndefined();
    expect(storedSnapshot.screenshot?.path).toBe(saved.screenshotPath);
  });
});
