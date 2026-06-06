import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { BrowserActionEvidenceEvent, BrowserSnapshot } from '../types.js';

/**
 * Owns browser run evidence persistence for the validation spike.
 */
export class BrowserEvidenceService {
  constructor(private readonly runDir: string) {}

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.runDir, { recursive: true }),
      mkdir(join(this.runDir, 'screenshots'), { recursive: true }),
      mkdir(join(this.runDir, 'snapshots'), { recursive: true }),
    ]);
  }

  async recordEvent(event: BrowserActionEvidenceEvent): Promise<void> {
    await this.initialize();
    await appendFile(join(this.runDir, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  }

  async recordSnapshot(snapshot: BrowserSnapshot): Promise<string> {
    await this.initialize();
    const path = join(this.runDir, 'snapshots', `${snapshot.id}.json`);
    await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
    return path;
  }

  screenshotPath(actionId: string, name?: string): string {
    const safeName = name ? name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') : actionId;
    return join(this.runDir, 'screenshots', `${safeName || actionId}.png`);
  }
}
