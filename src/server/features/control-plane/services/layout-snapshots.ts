import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SavedLayoutSnapshot = {
  jsonPath: string;
  screenshotPath?: string;
};

type SnapshotRecord = Record<string, unknown>;

const SNAPSHOT_DIR = 'debug/dom-snapshots';
const DATA_URL_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

export async function saveControlPlaneLayoutSnapshot(stateRoot: string, snapshot: unknown): Promise<SavedLayoutSnapshot> {
  if (!isRecord(snapshot)) {
    throw new Error('Layout snapshot payload must be an object.');
  }

  const outputDir = join(stateRoot, SNAPSHOT_DIR);
  await mkdir(outputDir, { recursive: true });

  const capturedAt = typeof snapshot.capturedAt === 'string' ? snapshot.capturedAt : new Date().toISOString();
  const timestamp = sanitizeFilenamePart(capturedAt.replaceAll(':', '-'));
  const label = deriveSnapshotLabel(snapshot);
  const basename = `${timestamp}-${label}`;
  const jsonPath = join(outputDir, `${basename}.json`);

  const persistedSnapshot = cloneJsonRecord(snapshot);
  const screenshotPath = await persistScreenshot(outputDir, basename, persistedSnapshot);

  await writeFile(jsonPath, `${JSON.stringify(persistedSnapshot, null, 2)}\n`, 'utf8');
  return screenshotPath ? { jsonPath, screenshotPath } : { jsonPath };
}

async function persistScreenshot(outputDir: string, basename: string, snapshot: SnapshotRecord): Promise<string | undefined> {
  const screenshot = snapshot.screenshot;
  if (!isRecord(screenshot) || screenshot.status !== 'captured' || typeof screenshot.dataUrl !== 'string') {
    return undefined;
  }

  const match = DATA_URL_PATTERN.exec(screenshot.dataUrl);
  if (!match?.[1]) {
    snapshot.screenshot = {
      ...screenshot,
      status: 'failed',
      reason: 'Screenshot data URL was not a PNG image.',
      dataUrl: undefined,
    };
    return undefined;
  }

  const screenshotPath = join(outputDir, `${basename}.png`);
  await writeFile(screenshotPath, Buffer.from(match[1], 'base64'));
  snapshot.screenshot = {
    ...screenshot,
    path: screenshotPath,
    dataUrl: undefined,
  };
  return screenshotPath;
}

function deriveSnapshotLabel(snapshot: SnapshotRecord): string {
  const appState = isRecord(snapshot.appState) ? snapshot.appState : {};
  const parts = [
    typeof appState.activeTab === 'string' ? appState.activeTab : 'control-plane',
    typeof appState.selectedSessionId === 'string' ? appState.selectedSessionId : undefined,
    isRecord(appState.pendingApproval) && typeof appState.pendingApproval.tool === 'string' ? `approval-${appState.pendingApproval.tool}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return sanitizeFilenamePart(parts.join('-')) || 'snapshot';
}

function sanitizeFilenamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function cloneJsonRecord(value: SnapshotRecord): SnapshotRecord {
  return JSON.parse(JSON.stringify(value)) as SnapshotRecord;
}

function isRecord(value: unknown): value is SnapshotRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
