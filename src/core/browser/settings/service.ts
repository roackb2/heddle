import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import dayjs from 'dayjs';
import { z } from 'zod';

import type { BrowserBackendSelection, BrowserProfileConfig } from '../types.js';
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
export const DEFAULT_BROWSER_BACKEND: BrowserBackendSelection = 'playwright-managed';
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const browserSettingsSchema = z.object({
  profileId: z.string().regex(PROFILE_ID_PATTERN).optional(),
  backend: z.enum(['playwright-managed', 'native-chrome-cdp']).optional(),
  channel: z.enum(['chrome', 'chromium', 'msedge']).optional(),
  headless: z.boolean().optional(),
  cdpEndpoint: z.string().optional(),
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

  static resolveNativeChromeProfileDir(stateRoot: string, profileId: string): string {
    return join(stateRoot, 'native-chrome-profiles', profileId);
  }

  static resolveSelectedProfileDir(stateRoot: string, settings: BrowserProfileSettings): string {
    return (settings.backend ?? DEFAULT_BROWSER_BACKEND) === 'native-chrome-cdp'
      ? BrowserProfileSettingsService.resolveNativeChromeProfileDir(stateRoot, settings.profileId)
      : BrowserProfileSettingsService.resolveProfileDir(stateRoot, settings.profileId);
  }

  static validateProfileId(profileId: string): { ok: true } | { ok: false; error: string } {
    return PROFILE_ID_PATTERN.test(profileId)
      ? { ok: true }
      : {
          ok: false,
          error: 'Profile id must start with a letter or number and only use letters, numbers, dots, underscores, or hyphens.',
        };
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
      backend: parsed.data.backend ?? DEFAULT_BROWSER_BACKEND,
      channel: parsed.data.channel,
      headless: parsed.data.headless ?? true,
      cdpEndpoint: parsed.data.cdpEndpoint,
      updatedAt: parsed.data.updatedAt,
    };
  }

  static overview(stateRoot: string): BrowserProfileSettingsOverview {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    const profiles = BrowserProfileSettingsService.listProfiles(stateRoot, settings);

    return {
      ...settings,
      backendSelection: settings.backend ?? DEFAULT_BROWSER_BACKEND,
      channelSelection: settings.channel ?? DEFAULT_BROWSER_CHANNEL,
      displayMode: BrowserProfileSettingsService.displayMode(settings),
      settingsStorePath: BrowserProfileSettingsService.resolveSettingsPath(stateRoot),
      userDataDir: BrowserProfileSettingsService.resolveSelectedProfileDir(stateRoot, settings),
      profiles,
      profileInstruction: BrowserProfileSettingsService.profileInstruction(settings),
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
    const profileIdValidation = BrowserProfileSettingsService.validateProfileId(profileId);
    if (!profileIdValidation.ok) {
      return {
        ok: false,
        error: profileIdValidation.error,
        settings: BrowserProfileSettingsService.overview(stateRoot),
      };
    }

    const cdpEndpoint = input.cdpEndpoint === undefined ? current.cdpEndpoint : input.cdpEndpoint.trim();
    const cdpEndpointValidation = BrowserProfileSettingsService.validateCdpEndpoint(cdpEndpoint);
    if (!cdpEndpointValidation.ok) {
      return {
        ok: false,
        error: cdpEndpointValidation.error,
        settings: BrowserProfileSettingsService.overview(stateRoot),
      };
    }

    const next: BrowserProfileSettings = {
      profileId,
      backend: input.backend ?? current.backend,
      channel: input.channel ?? current.channel,
      headless: input.headless ?? current.headless,
      cdpEndpoint: cdpEndpoint || undefined,
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

  static toolkitOptions(stateRoot: string): Pick<BrowserProfileConfig, 'profileId' | 'backend' | 'channel' | 'headless' | 'cdpEndpoint'> {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    return {
      profileId: settings.profileId,
      backend: settings.backend,
      channel: settings.channel,
      headless: settings.headless,
      cdpEndpoint: settings.cdpEndpoint,
    };
  }

  private static defaultSettings(): BrowserProfileSettings {
    return {
      profileId: DEFAULT_BROWSER_PROFILE_ID,
      backend: DEFAULT_BROWSER_BACKEND,
      headless: true,
    };
  }

  private static validateCdpEndpoint(endpoint: string | undefined): { ok: true } | { ok: false; error: string } {
    if (!endpoint) {
      return { ok: true };
    }

    try {
      const parsed = new URL(endpoint);
      const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
      if (parsed.protocol !== 'http:' || !isLoopback || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        return {
          ok: false,
          error: 'Native Chrome CDP endpoint must be a local http origin such as http://127.0.0.1:9223.',
        };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: 'Native Chrome CDP endpoint must be a valid local http origin such as http://127.0.0.1:9223.',
      };
    }
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

  private static profileInstruction(settings: BrowserProfileSettings): string {
    return (settings.backend ?? DEFAULT_BROWSER_BACKEND) === 'native-chrome-cdp'
      ? 'Launch native Chrome with the matching Heddle profile and remote debugging port, then keep that browser open while the agent attaches to its CDP endpoint.'
      : 'Use headed mode with this Heddle-managed profile to log in manually, then switch back to headless when you only need the saved session.';
  }

  private static listProfiles(stateRoot: string, settings: BrowserProfileSettings): BrowserProfileView[] {
    const selectedProfileId = settings.profileId;
    const nativeChrome = (settings.backend ?? DEFAULT_BROWSER_BACKEND) === 'native-chrome-cdp';
    const profilesRoot = nativeChrome
      ? join(stateRoot, 'native-chrome-profiles')
      : join(stateRoot, 'browser-profiles');
    const discovered = existsSync(profilesRoot)
      ? readdirSync(profilesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && PROFILE_ID_PATTERN.test(entry.name))
        .map((entry) => entry.name)
      : [];

    return Array.from(new Set([selectedProfileId, ...discovered]))
      .sort((a, b) => Number(b === selectedProfileId) - Number(a === selectedProfileId) || a.localeCompare(b))
      .map((profileId) => ({
        profileId,
        userDataDir: nativeChrome
          ? BrowserProfileSettingsService.resolveNativeChromeProfileDir(stateRoot, profileId)
          : BrowserProfileSettingsService.resolveProfileDir(stateRoot, profileId),
        selected: profileId === selectedProfileId,
      }));
  }
}
