import { join } from 'node:path';

import {
  BrowserProfileService,
  BrowserSessionService,
  PlaywrightBrowserDriverFactory,
  type BrowserPolicyConfig,
  type BrowserProfileLease,
  type BrowserProfileConfig,
  type BrowserDriverFactory,
  type BrowserSessionConfig,
  type BrowserSnapshot,
} from '../../../browser/index.js';
import type { ToolDefinition, ToolResult } from '../../../types.js';
import type { ToolToolkit } from '../../toolkit.js';

export type BrowserResearchToolkitOptions = {
  stateRoot: string;
  allowedDomains: string[];
  profileId?: string;
  evidenceRoot?: string;
  channel?: BrowserProfileConfig['channel'];
  headless?: boolean;
  maxElementsPerSnapshot?: number;
  driverFactory?: BrowserDriverFactory;
};

type BrowserOpenInput = {
  url: string;
};

type BrowserClickInput = {
  ref: string;
};

type BrowserScreenshotInput = {
  name?: string;
};

type BrowserRuntimeState = {
  lease?: BrowserProfileLease;
  session?: BrowserSessionService;
  opened: boolean;
};

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
      'Open an allowlisted URL in the experimental Heddle-owned browser research profile. Use this before browser_snapshot, browser_click, or browser_screenshot. Input example: { "url": "https://en.wikipedia.org/wiki/Browser_automation" }.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to open. The browser policy allowlist must permit the domain.',
        },
      },
      required: ['url'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isBrowserOpenInput(raw)) {
        return invalidInput('browser_open', 'Required field: url.');
      }

      const session = await getBrowserSession(options, state);
      const result = await session.open({ url: raw.url });
      state.opened = result.status === 'allowed';

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
): Promise<BrowserSessionService> {
  if (state.session) {
    return state.session;
  }

  const lease = await BrowserProfileService.acquire({
    stateRoot: options.stateRoot,
    profileId: options.profileId ?? 'browser-research',
    channel: options.channel,
    headless: options.headless,
  });
  state.lease = lease;
  state.session = new BrowserSessionService(
    createSessionConfig(options, lease.profile),
    options.driverFactory ?? new PlaywrightBrowserDriverFactory(),
  );
  return state.session;
}

async function closeBrowserState(state: BrowserRuntimeState): Promise<Awaited<ReturnType<BrowserSessionService['close']>> | undefined> {
  const result = await state.session?.close();
  state.lease?.release();
  state.session = undefined;
  state.lease = undefined;
  state.opened = false;
  return result;
}

function createSessionConfig(
  options: BrowserResearchToolkitOptions,
  profile: BrowserProfileConfig,
): BrowserSessionConfig {
  return {
    profile,
    policy: createPolicyConfig(options),
    evidenceDir: join(options.evidenceRoot ?? join(options.stateRoot, 'browser-runs'), `run-${Date.now()}`),
  };
}

function createPolicyConfig(options: BrowserResearchToolkitOptions): BrowserPolicyConfig {
  return {
    allowedDomains: options.allowedDomains,
    maxElementsPerSnapshot: options.maxElementsPerSnapshot,
  };
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
    elements: snapshot.elements.map((element) => ({
      ref: element.ref,
      role: element.role,
      name: element.name,
      href: element.href,
      text: element.text,
    })),
  };
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
