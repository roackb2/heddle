import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import dayjs from 'dayjs';
import { z } from 'zod';

import type { BrowserProfileConfig } from '../types.js';
import type {
  BrowserDisplayMode,
  BrowserProfileSettings,
  BrowserProfileSettingsOverview,
  BrowserProfileSettingsUpdateInput,
  BrowserProfileSettingsUpdateResult,
  BrowserProfileView,
} from './types.js';

export const DEFAULT_BROWSER_PROFILE_ID = 'browser-automation';
export const DEFAULT_BROWSER_CHANNEL = 'chromium';
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const browserSettingsSchema = z.object({
  profileId: z.string().regex(PROFILE_ID_PATTERN).optional(),
  channel: z.enum(['chrome', 'chromium', 'msedge']).optional(),
  headless: z.boolean().optional(),
  updatedAt: z.string().optional(),
});

/**
 * Owns persisted browser execution settings for Heddle-managed profiles.
 */
export class BrowserProfileSettingsService {
  static resolveSettingsPath(stateRoot: string): string {
    return join(stateRoot, 'browser', 'settings.json');
  }

  static resolveProfileDir(stateRoot: string, profileId: string): string {
    return join(stateRoot, 'browser-profiles', profileId);
  }

  static read(stateRoot: string): BrowserProfileSettings {
    const settingsPath = BrowserProfileSettingsService.resolveSettingsPath(stateRoot);
    if (!existsSync(settingsPath)) {
      return BrowserProfileSettingsService.defaultSettings();
    }

    const parsed = BrowserProfileSettingsService.readSettingsFile(settingsPath);
    if (!parsed.success) {
      return BrowserProfileSettingsService.defaultSettings();
    }

    return {
      profileId: parsed.data.profileId ?? DEFAULT_BROWSER_PROFILE_ID,
      channel: parsed.data.channel,
      headless: parsed.data.headless ?? true,
      updatedAt: parsed.data.updatedAt,
    };
  }

  static overview(stateRoot: string): BrowserProfileSettingsOverview {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    const profiles = BrowserProfileSettingsService.listProfiles(stateRoot, settings.profileId);

    return {
      ...settings,
      channelSelection: settings.channel ?? DEFAULT_BROWSER_CHANNEL,
      displayMode: BrowserProfileSettingsService.displayMode(settings),
      settingsStorePath: BrowserProfileSettingsService.resolveSettingsPath(stateRoot),
      userDataDir: BrowserProfileSettingsService.resolveProfileDir(stateRoot, settings.profileId),
      profiles,
      profileInstruction:
        'Use headed mode with this Heddle-managed profile to log in manually, then switch back to headless when you only need the saved session.',
      evidenceNote:
        'Screenshots and snapshots are per browser run. They should surface with session activity evidence rather than as global profile settings.',
    };
  }

  static update(
    stateRoot: string,
    input: BrowserProfileSettingsUpdateInput,
  ): BrowserProfileSettingsUpdateResult {
    const current = BrowserProfileSettingsService.read(stateRoot);
    const profileId = input.profileId === undefined ? current.profileId : input.profileId.trim();
    if (!PROFILE_ID_PATTERN.test(profileId)) {
      return {
        ok: false,
        error: 'Profile id must start with a letter or number and only use letters, numbers, dots, underscores, or hyphens.',
        settings: BrowserProfileSettingsService.overview(stateRoot),
      };
    }

    const next: BrowserProfileSettings = {
      profileId,
      channel: input.channel ?? current.channel,
      headless: input.headless ?? current.headless,
      updatedAt: dayjs().toISOString(),
    };

    const settingsPath = BrowserProfileSettingsService.resolveSettingsPath(stateRoot);
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

    return {
      ok: true,
      settings: BrowserProfileSettingsService.overview(stateRoot),
    };
  }

  static toolkitOptions(stateRoot: string): Pick<BrowserProfileConfig, 'profileId' | 'channel' | 'headless'> {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    return {
      profileId: settings.profileId,
      channel: settings.channel,
      headless: settings.headless,
    };
  }

  private static defaultSettings(): BrowserProfileSettings {
    return {
      profileId: DEFAULT_BROWSER_PROFILE_ID,
      headless: true,
    };
  }

  private static readSettingsFile(settingsPath: string): ReturnType<typeof browserSettingsSchema.safeParse> {
    try {
      return browserSettingsSchema.safeParse(JSON.parse(readFileSync(settingsPath, 'utf8')));
    } catch {
      return browserSettingsSchema.safeParse(undefined);
    }
  }

  private static displayMode(settings: BrowserProfileSettings): BrowserDisplayMode {
    return settings.headless ? 'headless' : 'headed';
  }

  private static listProfiles(stateRoot: string, selectedProfileId: string): BrowserProfileView[] {
    const profilesRoot = join(stateRoot, 'browser-profiles');
    const discovered = existsSync(profilesRoot)
      ? readdirSync(profilesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && PROFILE_ID_PATTERN.test(entry.name))
        .map((entry) => entry.name)
      : [];

    return Array.from(new Set([selectedProfileId, ...discovered]))
      .sort((a, b) => Number(b === selectedProfileId) - Number(a === selectedProfileId) || a.localeCompare(b))
      .map((profileId) => ({
        profileId,
        userDataDir: BrowserProfileSettingsService.resolveProfileDir(stateRoot, profileId),
        selected: profileId === selectedProfileId,
      }));
  }
}
