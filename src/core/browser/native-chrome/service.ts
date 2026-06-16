import { existsSync, mkdirSync } from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import dayjs from 'dayjs';

import { BrowserProfileSettingsService } from '../settings/index.js';
import type {
  NativeChromeConnectionStatus,
  NativeChromeLaunchInput,
  NativeChromeLaunchResult,
} from './types.js';

export const DEFAULT_NATIVE_CHROME_CDP_PORT = 9223;
export const DEFAULT_NATIVE_CHROME_START_URL = 'https://en.wikipedia.org/wiki/Main_Page';

const CHROME_PATH_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

type CdpVersionResponse = {
  Browser?: string;
  webSocketDebuggerUrl?: string;
};

type LaunchCommand = {
  command: string;
  args: string[];
  display: string;
};

/**
 * Owns native Chrome process launch and CDP health checks for browser automation.
 *
 * The CDP driver owns browser actions after attach. This service only prepares
 * the user-authorized Chrome window and records the endpoint/profile settings
 * that future browser tool runs should use.
 */
export class NativeChromeProfileService {
  static defaultEndpoint(): string {
    return NativeChromeProfileService.endpointForPort(DEFAULT_NATIVE_CHROME_CDP_PORT);
  }

  static endpointForPort(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  static async status(stateRoot: string): Promise<NativeChromeConnectionStatus> {
    const settings = BrowserProfileSettingsService.read(stateRoot);
    const endpoint = settings.cdpEndpoint ?? NativeChromeProfileService.defaultEndpoint();
    return await NativeChromeProfileService.connectionStatus({
      stateRoot,
      profileId: settings.profileId,
      endpoint,
    });
  }

  static async launch(stateRoot: string, input: NativeChromeLaunchInput = {}): Promise<NativeChromeLaunchResult> {
    const currentSettings = BrowserProfileSettingsService.read(stateRoot);
    const profileId = input.profileId?.trim() || currentSettings.profileId;
    const profileIdValidation = BrowserProfileSettingsService.validateProfileId(profileId);
    const endpoint = NativeChromeProfileService.resolveEndpoint(input.port, currentSettings.cdpEndpoint);
    const port = NativeChromeProfileService.portFromEndpoint(endpoint);
    const startUrlResult = NativeChromeProfileService.normalizeStartUrl(input.url);
    const startUrl = startUrlResult.ok ? startUrlResult.url : DEFAULT_NATIVE_CHROME_START_URL;
    const statusBeforeLaunch = await NativeChromeProfileService.connectionStatus({ stateRoot, profileId, endpoint });

    if (!profileIdValidation.ok) {
      return {
        ok: false,
        error: profileIdValidation.error,
        status: statusBeforeLaunch,
        startUrl,
        reusedExisting: false,
      };
    }

    if (!startUrlResult.ok) {
      return {
        ok: false,
        error: startUrlResult.error,
        status: statusBeforeLaunch,
        startUrl,
        reusedExisting: false,
      };
    }

    if (statusBeforeLaunch.state === 'reachable') {
      await BrowserProfileSettingsService.update(stateRoot, {
        profileId,
        backend: 'native-chrome-cdp',
        cdpEndpoint: endpoint,
      });
      return {
        ok: true,
        status: await NativeChromeProfileService.connectionStatus({ stateRoot, profileId, endpoint }),
        startUrl,
        reusedExisting: true,
      };
    }

    const chromePath = input.chromePath ?? NativeChromeProfileService.findChromePath();
    if (!chromePath) {
      return {
        ok: false,
        error: 'Could not find Google Chrome. Install Chrome or pass an explicit Chrome path from the launcher script.',
        status: statusBeforeLaunch,
        startUrl,
        reusedExisting: false,
      };
    }

    if (!await NativeChromeProfileService.isPortAvailable(port)) {
      return {
        ok: false,
        error: `Port ${port} is already in use, but ${endpoint}/json/version is not reachable. Choose another endpoint or close the process using that port.`,
        status: statusBeforeLaunch,
        startUrl,
        reusedExisting: false,
      };
    }

    const userDataDir = BrowserProfileSettingsService.resolveNativeChromeProfileDir(stateRoot, profileId);
    const launchCommand = NativeChromeProfileService.createLaunchCommand(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--new-window',
      '--no-first-run',
      '--no-default-browser-check',
      startUrl,
    ]);

    mkdirSync(userDataDir, { recursive: true });
    const child = spawn(launchCommand.command, launchCommand.args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    const reachable = await NativeChromeProfileService.waitForCdpEndpoint(endpoint, 10_000);
    const status = await NativeChromeProfileService.connectionStatus({ stateRoot, profileId, endpoint });
    if (!reachable) {
      return {
        ok: false,
        error: `${endpoint}/json/version did not become reachable after launching Chrome. Close conflicting Chrome windows for this profile and try again.`,
        status,
        startUrl,
        launchCommand: launchCommand.display,
        reusedExisting: false,
      };
    }

    await BrowserProfileSettingsService.update(stateRoot, {
      profileId,
      backend: 'native-chrome-cdp',
      cdpEndpoint: endpoint,
    });

    return {
      ok: true,
      status: await NativeChromeProfileService.connectionStatus({ stateRoot, profileId, endpoint }),
      startUrl,
      launchCommand: launchCommand.display,
      reusedExisting: false,
    };
  }

  private static resolveEndpoint(port: number | undefined, currentEndpoint: string | undefined): string {
    if (port !== undefined) {
      return NativeChromeProfileService.endpointForPort(port);
    }
    return currentEndpoint ?? NativeChromeProfileService.defaultEndpoint();
  }

  private static async connectionStatus(options: {
    stateRoot: string;
    profileId: string;
    endpoint: string;
  }): Promise<NativeChromeConnectionStatus> {
    const version = await NativeChromeProfileService.fetchCdpVersion(options.endpoint);
    return {
      state: version ? 'reachable' : 'unreachable',
      profileId: options.profileId,
      userDataDir: BrowserProfileSettingsService.resolveNativeChromeProfileDir(options.stateRoot, options.profileId),
      endpoint: options.endpoint,
      port: NativeChromeProfileService.portFromEndpoint(options.endpoint),
      defaultStartUrl: DEFAULT_NATIVE_CHROME_START_URL,
      browser: version?.Browser,
      webSocketDebuggerUrl: version?.webSocketDebuggerUrl,
      checkedAt: dayjs().toISOString(),
    };
  }

  private static normalizeStartUrl(url: string | undefined): { ok: true; url: string } | { ok: false; error: string } {
    const value = url?.trim() || DEFAULT_NATIVE_CHROME_START_URL;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:', 'about:'].includes(parsed.protocol)) {
        return { ok: false, error: 'Native Chrome start URL must use http, https, or about.' };
      }
      return { ok: true, url: parsed.href };
    } catch {
      return { ok: false, error: 'Native Chrome start URL must be a valid URL.' };
    }
  }

  private static portFromEndpoint(endpoint: string): number {
    const parsed = new URL(endpoint);
    const port = Number(parsed.port || (parsed.protocol === 'http:' ? 80 : 443));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Native Chrome CDP endpoint must include a port between 1024 and 65535.');
    }
    return port;
  }

  private static findChromePath(): string | undefined {
    return CHROME_PATH_CANDIDATES.find((candidate) => existsSync(candidate));
  }

  private static createLaunchCommand(chromePath: string, chromeArgs: string[]): LaunchCommand {
    const macAppBundle = process.platform === 'darwin'
      ? NativeChromeProfileService.macAppBundlePath(chromePath)
      : undefined;
    if (macAppBundle) {
      const args = ['-n', '-a', macAppBundle, '--args', ...chromeArgs];
      return {
        command: '/usr/bin/open',
        args,
        display: [quote('/usr/bin/open'), ...args.map(quote)].join(' '),
      };
    }

    return {
      command: chromePath,
      args: chromeArgs,
      display: [quote(chromePath), ...chromeArgs.map(quote)].join(' '),
    };
  }

  private static macAppBundlePath(chromePath: string): string | undefined {
    const marker = '.app/Contents/MacOS/';
    const markerIndex = chromePath.indexOf(marker);
    return markerIndex === -1
      ? undefined
      : chromePath.slice(0, markerIndex + '.app'.length);
  }

  private static async waitForCdpEndpoint(endpoint: string, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await NativeChromeProfileService.fetchCdpVersion(endpoint)) {
        return true;
      }
      await sleep(250);
    }

    return false;
  }

  private static async fetchCdpVersion(endpoint: string): Promise<CdpVersionResponse | undefined> {
    return new Promise((resolveVersion) => {
      const request = get(new URL('/json/version', endpoint), (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            resolveVersion(undefined);
            return;
          }
          try {
            resolveVersion(JSON.parse(Buffer.concat(chunks).toString('utf8')) as CdpVersionResponse);
          } catch {
            resolveVersion(undefined);
          }
        });
      });
      request.setTimeout(1000, () => {
        request.destroy();
        resolveVersion(undefined);
      });
      request.once('error', () => resolveVersion(undefined));
    });
  }

  private static isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolvePort) => {
      const server = createServer();
      server.once('error', () => resolvePort(false));
      server.once('listening', () => {
        server.close(() => resolvePort(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}
