import dayjs from 'dayjs';

import { PlaywrightBrowserDriverFactory } from '../playwright/index.js';
import { BrowserProfileService, type BrowserProfileLease } from '../profiles/index.js';
import { BrowserProfileSettingsService } from '../settings/index.js';
import type { BrowserDriver } from '../types.js';
import type {
  BrowserProfileWindowOpenInput,
  BrowserProfileWindowResult,
  BrowserProfileWindowStatus,
} from './types.js';

type OpenProfileWindow = {
  driver: BrowserDriver;
  lease: BrowserProfileLease;
  openedAt: string;
};

const openWindows = new Map<string, OpenProfileWindow>();

/**
 * Owns user-managed browser windows for preparing Heddle-owned profiles.
 */
export class BrowserProfileWindowService {
  static status(stateRoot: string): BrowserProfileWindowStatus {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    const userDataDir = BrowserProfileSettingsService.resolveProfileDir(stateRoot, settings.profileId);
    const window = openWindows.get(BrowserProfileWindowService.windowKey(stateRoot, settings.profileId));

    return {
      profileId: settings.profileId,
      userDataDir,
      open: Boolean(window),
      currentUrl: window?.driver.currentUrl(),
      openedAt: window?.openedAt,
    };
  }

  static async open(stateRoot: string, input: BrowserProfileWindowOpenInput = {}): Promise<BrowserProfileWindowResult> {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    const status = BrowserProfileWindowService.status(stateRoot);
    const parsedUrl = BrowserProfileWindowService.parseOptionalUrl(input.url);
    if (!parsedUrl.ok) {
      return {
        ok: false,
        error: parsedUrl.error,
        status,
      };
    }

    const key = BrowserProfileWindowService.windowKey(stateRoot, settings.profileId);
    const existing = openWindows.get(key);
    if (existing) {
      return await BrowserProfileWindowService.navigateExistingWindow(stateRoot, existing, parsedUrl.url);
    }

    let lease: BrowserProfileLease | undefined;
    try {
      lease = await BrowserProfileService.acquire({
        stateRoot,
        profileId: settings.profileId,
        channel: settings.channel,
        headless: false,
      });
      const driver = await (input.driverFactory ?? new PlaywrightBrowserDriverFactory()).launch({
        profile: lease.profile,
      });
      if (parsedUrl.url) {
        await driver.open(parsedUrl.url);
      }
      openWindows.set(key, {
        driver,
        lease,
        openedAt: dayjs().toISOString(),
      });

      return {
        ok: true,
        status: BrowserProfileWindowService.status(stateRoot),
      };
    } catch (error) {
      lease?.release();
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: BrowserProfileWindowService.status(stateRoot),
      };
    }
  }

  static async close(stateRoot: string): Promise<BrowserProfileWindowResult> {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    const key = BrowserProfileWindowService.windowKey(stateRoot, settings.profileId);
    const window = openWindows.get(key);
    if (!window) {
      return {
        ok: true,
        status: BrowserProfileWindowService.status(stateRoot),
      };
    }

    let closeError: unknown;
    try {
      await window.driver.close();
    } catch (error) {
      closeError = error;
    } finally {
      openWindows.delete(key);
      window.lease.release();
    }

    const status = BrowserProfileWindowService.status(stateRoot);
    return closeError
      ? {
        ok: false,
        error: closeError instanceof Error ? closeError.message : String(closeError),
        status,
      }
      : {
        ok: true,
        status,
      };
  }

  private static async navigateExistingWindow(
    stateRoot: string,
    window: OpenProfileWindow,
    url: string | undefined,
  ): Promise<BrowserProfileWindowResult> {
    try {
      if (url) {
        await window.driver.open(url);
      }

      return {
        ok: true,
        status: BrowserProfileWindowService.status(stateRoot),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: BrowserProfileWindowService.status(stateRoot),
      };
    }
  }

  private static parseOptionalUrl(url: string | undefined): { ok: true; url?: string } | { ok: false; error: string } {
    const trimmed = url?.trim();
    if (!trimmed) {
      return { ok: true };
    }

    try {
      const parsed = new URL(trimmed);
      return ['http:', 'https:'].includes(parsed.protocol)
        ? { ok: true, url: parsed.toString() }
        : { ok: false, error: 'Browser profile windows only support http or https start URLs.' };
    } catch {
      return { ok: false, error: 'Browser profile window start URL must be a valid http or https URL.' };
    }
  }

  private static windowKey(stateRoot: string, profileId: string): string {
    return `${stateRoot}:${profileId}`;
  }
}
