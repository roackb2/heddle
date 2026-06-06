import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { BrowserProfileConfig } from '../types.js';

const activeProfileDirs = new Set<string>();

export interface ResolveBrowserProfileInput {
  stateRoot: string;
  profileId?: string;
  channel?: BrowserProfileConfig['channel'];
  headless?: boolean;
}

export interface BrowserProfileLease {
  profile: BrowserProfileConfig;
  release(): void;
}

/**
 * Owns Heddle browser profile path resolution and in-process profile locks.
 */
export class BrowserProfileService {
  static async acquire(input: ResolveBrowserProfileInput): Promise<BrowserProfileLease> {
    const profileId = input.profileId ?? 'default';
    const userDataDir = join(input.stateRoot, 'browser-profiles', profileId);
    if (activeProfileDirs.has(userDataDir)) {
      throw new Error(`Browser profile "${profileId}" is already in use by this process.`);
    }

    activeProfileDirs.add(userDataDir);
    await mkdir(userDataDir, { recursive: true });

    let released = false;
    return {
      profile: {
        profileId,
        userDataDir,
        channel: input.channel,
        headless: input.headless,
      },
      release() {
        if (released) {
          return;
        }
        released = true;
        activeProfileDirs.delete(userDataDir);
      },
    };
  }
}
