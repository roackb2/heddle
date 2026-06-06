import { randomUUID } from 'node:crypto';

import dayjs from 'dayjs';

import type { BrowserDriverSnapshotResult, BrowserSnapshot } from '../types.js';

/**
 * Owns snapshot ids, timestamps, and the host-facing snapshot shape.
 */
export class BrowserSnapshotService {
  static create(input: BrowserDriverSnapshotResult): BrowserSnapshot {
    return {
      id: `browser_snapshot_${randomUUID()}`,
      url: input.url,
      title: input.title,
      capturedAt: dayjs().toISOString(),
      ariaSnapshot: input.ariaSnapshot,
      elements: input.elements,
    };
  }
}
