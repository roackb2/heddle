import { join } from 'node:path';

import {
  BrowserDriverFactoryService,
  NativeChromeProfileService,
  BrowserProfileService,
  BrowserProfileSettingsService,
  BrowserSessionService,
  type BrowserPolicyConfig,
  type BrowserProfileLease,
  type BrowserProfileConfig,
  type BrowserDriverFactory,
  type BrowserSessionConfig,
  type BrowserSnapshot,
  type NativeChromeConnectionStatus,
  type NativeChromeLaunchInput,
  type NativeChromeLaunchResult,
} from '../../../browser/index.js';
import type { ToolDefinition, ToolResult } from '../../../types.js';
import type { ToolToolkit } from '../../toolkit.js';

type NativeChromeLauncher = {
  status: (stateRoot: string) => Promise<NativeChromeConnectionStatus>;
  launch: (stateRoot: string, input?: NativeChromeLaunchInput) => Promise<NativeChromeLaunchResult>;
};

export type BrowserResearchToolkitOptions = {
  stateRoot: string;
  allowedDomains: string[];
  profileId?: string;
  evidenceRoot?: string;
  backend?: BrowserProfileConfig['backend'];
  channel?: BrowserProfileConfig['channel'];
  headless?: boolean;
  cdpEndpoint?: string;
  maxElementsPerSnapshot?: number;
  driverFactory?: BrowserDriverFactory;
  nativeChromeLauncher?: NativeChromeLauncher;
  autoLaunchNativeChrome?: boolean;
};

type BrowserOpenInput = {
  url: string;
};

type BrowserClickInput = {
  ref: string;
};

type BrowserTypeInput = {
  ref: string;
  text: string;
  clear?: boolean;
  submit?: boolean;
};

type BrowserScreenshotInput = {
  name?: string;
};

type BrowserRuntimeState = {
  lease?: BrowserProfileLease;
  session?: BrowserSessionService;
  derivedAllowedDomains?: string[];
  opened: boolean;
};

const MAX_ARIA_SNAPSHOT_OUTPUT_LENGTH = 12000;

type BrowserSessionRequirement =
  | { ok: true; session: BrowserSessionService }
  | { ok: false; result: ToolResult };

export function createBrowserResearchToolkit(options: BrowserResearchToolkitOptions): ToolToolkit {
  const state: BrowserRuntimeState = { opened: false };

  return {
    id: 'browser-research',
    createTools() {
      return [
        createBrowserOpenTool(options, state),
        createBrowserSnapshotTool(state),
        createBrowserClickTool(state),
        createBrowserTypeTool(state),
        createBrowserScreenshotTool(state),
        createBrowserCloseTool(state),
      ];
    },
  };
}

function createBrowserOpenTool(
  options: BrowserResearchToolkitOptions,
  state: BrowserRuntimeState,
): ToolDefinition {
  return {
    name: 'browser_open',
    description:
      'Open a URL in the Heddle-owned browser research profile. Use this before browser_snapshot, browser_click, or browser_screenshot. If no explicit domain allowlist is configured, the first opened URL establishes the same-domain browsing boundary. Input example: { "url": "https://en.wikipedia.org/wiki/Browser_automation" }.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to open. Browser policy must permit the domain, or the session must be configured to derive its boundary from the first URL.',
        },
      },
      required: ['url'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isBrowserOpenInput(raw)) {
        return invalidInput('browser_open', 'Required field: url.');
      }

      const result = await openBrowserSession(options, state, raw.url);

      if (result.status === 'allowed') {
        return {
          ok: true,
          output: {
            status: result.status,
            url: result.data?.finalUrl,
            actionId: result.actionId,
          },
        };
      }

      await closeBrowserState(state);
      return {
        ok: false,
        error: result.reason ?? `browser_open was ${result.status}.`,
        output: { status: result.status, actionId: result.actionId },
      };
    },
  };
}

async function openBrowserSession(
  options: BrowserResearchToolkitOptions,
  state: BrowserRuntimeState,
  url: string,
): Promise<Awaited<ReturnType<BrowserSessionService['open']>>> {
  if (shouldRestartDerivedSessionForUrl(options, state, url)) {
    await closeBrowserState(state);
  }

  const session = await getBrowserSession(options, state, url);

  try {
    const result = await session.open({ url });
    state.opened = result.status === 'allowed';
    if (result.status === 'allowed' && options.allowedDomains.length === 0) {
      state.derivedAllowedDomains = uniqueDomains([
        ...(state.derivedAllowedDomains ?? []),
        ...initialAllowedDomains(url),
        ...initialAllowedDomains(result.data?.finalUrl),
      ]);
    }
    return result;
  } catch (error) {
    await closeBrowserState(state);
    throw error;
  }
}

function createBrowserSnapshotTool(state: BrowserRuntimeState): ToolDefinition {
  return {
    name: 'browser_snapshot',
    description:
      'Capture an accessibility-oriented snapshot of the current browser page. Returns snapshot-scoped element refs that can be used with browser_click. Call browser_open first.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isEmptyObject(raw)) {
        return invalidInput('browser_snapshot', 'No input fields are supported.');
      }

      const sessionResult = requireOpenedSession(state, 'browser_snapshot');
      if (!sessionResult.ok) {
        return sessionResult.result;
      }

      const result = await sessionResult.session.snapshot();
      return {
        ok: true,
        output: formatSnapshotOutput(result.data),
      };
    },
  };
}

function createBrowserClickTool(state: BrowserRuntimeState): ToolDefinition {
  return {
    name: 'browser_click',
    description:
      'Click one element ref from the latest browser_snapshot. Browser policy blocks forbidden, off-domain, or approval-required targets before driver execution. Input example: { "ref": "el_3" }.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: {
          type: 'string',
          description: 'Snapshot-scoped element ref returned by browser_snapshot.',
        },
      },
      required: ['ref'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isBrowserClickInput(raw)) {
        return invalidInput('browser_click', 'Required field: ref.');
      }

      const sessionResult = requireOpenedSession(state, 'browser_click');
      if (!sessionResult.ok) {
        return sessionResult.result;
      }

      const result = await sessionResult.session.click({ ref: raw.ref });
      return result.status === 'allowed'
        ? {
          ok: true,
          output: {
            status: result.status,
            url: result.data?.finalUrl,
            actionId: result.actionId,
          },
        }
        : {
          ok: false,
          error: result.reason ?? `browser_click was ${result.status}.`,
          output: { status: result.status, url: result.url, actionId: result.actionId },
        };
    },
  };
}

function createBrowserTypeTool(state: BrowserRuntimeState): ToolDefinition {
  return {
    name: 'browser_type',
    description:
      'Type text into an editable element ref from the latest browser_snapshot. Use this for search boxes and text fields. By default it clears the field first. Set submit=true to press Enter after typing for search/navigation. Input example: { "ref": "el_4", "text": "browser automation", "submit": true }.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: {
          type: 'string',
          description: 'Snapshot-scoped editable element ref returned by browser_snapshot.',
        },
        text: {
          type: 'string',
          description: 'Text to type. Sensitive fields such as passwords, OTP, or payment fields are blocked by browser policy.',
        },
        clear: {
          type: 'boolean',
          description: 'Whether to clear the current field value before typing. Defaults to true.',
        },
        submit: {
          type: 'boolean',
          description: 'Whether to press Enter after typing. Useful for search fields. Defaults to false.',
        },
      },
      required: ['ref', 'text'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isBrowserTypeInput(raw)) {
        return invalidInput('browser_type', 'Required fields: ref, text. Optional fields: clear, submit.');
      }

      const sessionResult = requireOpenedSession(state, 'browser_type');
      if (!sessionResult.ok) {
        return sessionResult.result;
      }

      const result = await sessionResult.session.type({
        ref: raw.ref,
        text: raw.text,
        clear: raw.clear,
        submit: raw.submit,
      });
      return result.status === 'allowed'
        ? {
          ok: true,
          output: {
            status: result.status,
            url: result.data?.finalUrl,
            actionId: result.actionId,
          },
        }
        : {
          ok: false,
          error: result.reason ?? `browser_type was ${result.status}.`,
          output: { status: result.status, url: result.url, actionId: result.actionId },
        };
    },
  };
}

function createBrowserScreenshotTool(state: BrowserRuntimeState): ToolDefinition {
  return {
    name: 'browser_screenshot',
    description:
      'Capture a screenshot of the current browser page into the browser run evidence directory. Call browser_open first. Optional input: { "name": "final-page" }.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'Optional evidence filename label.',
        },
      },
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isBrowserScreenshotInput(raw)) {
        return invalidInput('browser_screenshot', 'Optional field: name.');
      }

      const sessionResult = requireOpenedSession(state, 'browser_screenshot');
      if (!sessionResult.ok) {
        return sessionResult.result;
      }

      const result = await sessionResult.session.screenshot({ name: raw?.name });
      return {
        ok: true,
        output: {
          status: result.status,
          path: result.data?.path,
          actionId: result.actionId,
        },
      };
    },
  };
}

function createBrowserCloseTool(state: BrowserRuntimeState): ToolDefinition {
  return {
    name: 'browser_close',
    description:
      'Close the current experimental browser research session and release its Heddle-owned profile lock. Use this when the research task is finished.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isEmptyObject(raw)) {
        return invalidInput('browser_close', 'No input fields are supported.');
      }

      const result = await closeBrowserState(state);

      return {
        ok: true,
        output: {
          status: result?.status ?? 'allowed',
          actionId: result?.actionId,
        },
      };
    },
  };
}

async function getBrowserSession(
  options: BrowserResearchToolkitOptions,
  state: BrowserRuntimeState,
  initialUrl?: string,
): Promise<BrowserSessionService> {
  if (state.session) {
    return state.session;
  }

  const profile = await resolveBrowserProfile(options, state, initialUrl);
  state.session = new BrowserSessionService(
    createSessionConfig(options, profile, initialUrl),
    options.driverFactory ?? BrowserDriverFactoryService.resolve(profile.backend),
  );
  return state.session;
}

async function resolveBrowserProfile(
  options: BrowserResearchToolkitOptions,
  state: BrowserRuntimeState,
  initialUrl?: string,
): Promise<BrowserProfileConfig> {
  if (options.backend === 'native-chrome-cdp') {
    const launcher = options.nativeChromeLauncher ?? NativeChromeProfileService;
    const launchResult = await prepareNativeChromeProfile(options, launcher, initialUrl);
    return {
      profileId: options.profileId ?? 'browser-research',
      userDataDir: BrowserProfileSettingsService.resolveNativeChromeProfileDir(
        options.stateRoot,
        options.profileId ?? 'browser-research',
      ),
      backend: 'native-chrome-cdp',
      cdpEndpoint: launchResult?.status.endpoint ?? options.cdpEndpoint,
    };
  }

  const lease = await BrowserProfileService.acquire({
    stateRoot: options.stateRoot,
    profileId: options.profileId ?? 'browser-research',
    channel: options.channel,
    headless: options.headless,
  });
  state.lease = lease;
  return {
    ...lease.profile,
    backend: 'playwright-managed',
  };
}

async function prepareNativeChromeProfile(
  options: BrowserResearchToolkitOptions,
  launcher: NativeChromeLauncher,
  initialUrl: string | undefined,
): Promise<NativeChromeLaunchResult | undefined> {
  if (!shouldAutoLaunchNativeChrome(options)) {
    return undefined;
  }

  const status = await launcher.status(options.stateRoot);
  if (status.state === 'reachable') {
    return undefined;
  }

  const launchResult = await launcher.launch(options.stateRoot, {
    profileId: options.profileId,
    url: initialUrl,
  });
  if (!launchResult.ok) {
    throw new Error(`Native Chrome launch failed: ${launchResult.error}`);
  }
  return launchResult;
}

function shouldAutoLaunchNativeChrome(options: BrowserResearchToolkitOptions): boolean {
  return options.autoLaunchNativeChrome ?? !options.driverFactory;
}

async function closeBrowserState(state: BrowserRuntimeState): Promise<Awaited<ReturnType<BrowserSessionService['close']>> | undefined> {
  try {
    return await state.session?.close();
  } finally {
    state.lease?.release();
    state.session = undefined;
    state.lease = undefined;
    state.derivedAllowedDomains = undefined;
    state.opened = false;
  }
}

function createSessionConfig(
  options: BrowserResearchToolkitOptions,
  profile: BrowserProfileConfig,
  initialUrl?: string,
): BrowserSessionConfig {
  return {
    profile,
    policy: createPolicyConfig(options, initialUrl),
    evidenceDir: join(options.evidenceRoot ?? join(options.stateRoot, 'browser-runs'), `run-${Date.now()}`),
  };
}

function createPolicyConfig(options: BrowserResearchToolkitOptions, initialUrl?: string): BrowserPolicyConfig {
  const explicitAllowedDomains = options.allowedDomains.length > 0;
  return {
    allowedDomains: explicitAllowedDomains
      ? options.allowedDomains
      : initialAllowedDomains(initialUrl),
    adoptFinalOpenDomain: !explicitAllowedDomains,
    maxElementsPerSnapshot: options.maxElementsPerSnapshot,
  };
}

function shouldRestartDerivedSessionForUrl(
  options: BrowserResearchToolkitOptions,
  state: BrowserRuntimeState,
  url: string,
): boolean {
  if (!state.session || options.allowedDomains.length > 0) {
    return false;
  }

  return !initialAllowedDomains(url).some((domain) => isAllowedByDomains(domain, state.derivedAllowedDomains ?? []));
}

function initialAllowedDomains(initialUrl: string | undefined): string[] {
  if (!initialUrl) {
    return [];
  }

  try {
    const hostname = new URL(initialUrl).hostname.toLowerCase();
    return hostname.startsWith('www.') ? [hostname.slice(4), hostname] : [hostname];
  } catch {
    return [];
  }
}

function isAllowedByDomains(hostname: string, allowedDomains: string[]): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return allowedDomains
    .map((domain) => domain.toLowerCase())
    .some((domain) => normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`));
}

function uniqueDomains(domains: string[]): string[] {
  return [...new Set(domains)];
}

function requireOpenedSession(
  state: BrowserRuntimeState,
  toolName: string,
): BrowserSessionRequirement {
  if (!state.session || !state.opened) {
    return {
      ok: false,
      result: {
        ok: false,
        error: `${toolName} requires browser_open to complete successfully first.`,
      },
    };
  }

  return { ok: true, session: state.session };
}

function formatSnapshotOutput(snapshot: BrowserSnapshot | undefined): unknown {
  if (!snapshot) {
    return undefined;
  }

  return {
    id: snapshot.id,
    url: snapshot.url,
    title: snapshot.title,
    capturedAt: snapshot.capturedAt,
    ariaSnapshot: truncateText(snapshot.ariaSnapshot, MAX_ARIA_SNAPSHOT_OUTPUT_LENGTH),
    ariaSnapshotLength: snapshot.ariaSnapshot.length,
    ariaSnapshotTruncated: snapshot.ariaSnapshot.length > MAX_ARIA_SNAPSHOT_OUTPUT_LENGTH,
    elements: snapshot.elements.map((element) => ({
      ref: element.ref,
      role: element.role,
      name: element.name,
      href: element.href,
      rawHref: element.rawHref,
      text: element.text,
      tagName: element.tagName,
      inputType: element.inputType,
      placeholder: element.placeholder,
      disabled: element.disabled,
      readonly: element.readonly,
      editable: element.editable,
    })),
  };
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n... [truncated]`;
}

function invalidInput(toolName: string, detail: string): ToolResult {
  return {
    ok: false,
    error: `Invalid input for ${toolName}. ${detail}`,
  };
}

function isBrowserOpenInput(raw: unknown): raw is BrowserOpenInput {
  if (!isPlainObject(raw, ['url'])) {
    return false;
  }

  return typeof raw.url === 'string' && raw.url.trim().length > 0;
}

function isBrowserClickInput(raw: unknown): raw is BrowserClickInput {
  if (!isPlainObject(raw, ['ref'])) {
    return false;
  }

  return typeof raw.ref === 'string' && raw.ref.trim().length > 0;
}

function isBrowserTypeInput(raw: unknown): raw is BrowserTypeInput {
  if (!isPlainObject(raw, ['ref', 'text', 'clear', 'submit'])) {
    return false;
  }

  const optionalBooleansAreValid = [raw.clear, raw.submit]
    .every((value) => value === undefined || typeof value === 'boolean');
  return typeof raw.ref === 'string'
    && raw.ref.trim().length > 0
    && typeof raw.text === 'string'
    && optionalBooleansAreValid;
}

function isBrowserScreenshotInput(raw: unknown): raw is BrowserScreenshotInput {
  if (raw === undefined) {
    return true;
  }

  if (!isPlainObject(raw, ['name'])) {
    return false;
  }

  return raw.name === undefined || (typeof raw.name === 'string' && raw.name.trim().length > 0);
}

function isEmptyObject(raw: unknown): boolean {
  return raw === undefined || isPlainObject(raw, []);
}

function isPlainObject(raw: unknown, allowedKeys: string[]): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const keys = Object.keys(raw);
  return keys.every((key) => allowedKeys.includes(key));
}
