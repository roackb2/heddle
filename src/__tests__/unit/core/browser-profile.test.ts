import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { BrowserProfileService } from '../../../core/browser/index.js';

describe('BrowserProfileService', () => {
  it('locks a profile path until its lease is released', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-profile-'));
    const lease = await BrowserProfileService.acquire({ stateRoot, profileId: 'research' });

    await expect(BrowserProfileService.acquire({ stateRoot, profileId: 'research' }))
      .rejects
      .toThrow('Browser profile "research" is already in use by this process.');

    lease.release();

    const secondLease = await BrowserProfileService.acquire({ stateRoot, profileId: 'research' });
    secondLease.release();
  });

  it('locks by resolved profile path instead of profile id alone', async () => {
    const firstStateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-profile-a-'));
    const secondStateRoot = await mkdtemp(join(tmpdir(), 'heddle-browser-profile-b-'));
    const firstLease = await BrowserProfileService.acquire({ stateRoot: firstStateRoot, profileId: 'research' });
    const secondLease = await BrowserProfileService.acquire({ stateRoot: secondStateRoot, profileId: 'research' });

    expect(firstLease.profile.userDataDir).not.toBe(secondLease.profile.userDataDir);

    firstLease.release();
    secondLease.release();
  });
});
