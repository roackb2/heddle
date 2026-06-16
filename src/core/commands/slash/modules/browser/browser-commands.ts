import { SlashCommandParser } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { slashMessageResult } from '../results.js';

const BROWSER_CHANNELS = ['chromium', 'chrome', 'msedge'] as const;
type BrowserSlashBackend = 'playwright-managed' | 'native-chrome-cdp';

export function createBrowserSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'browser',
    hints: [
      { command: '/browser', description: 'show Browser Automation status' },
      { command: '/browser enable', description: 'enable Browser Automation guidance and browser tools for this workspace' },
      { command: '/browser disable', description: 'disable Browser Automation guidance and browser tools for this workspace' },
      { command: '/browser headed', description: 'run Browser Automation in a visible browser window' },
      { command: '/browser headless', description: 'run Browser Automation without showing a browser window' },
      { command: '/browser profile <id>', description: 'select the Heddle-owned browser profile for future browser runs' },
      { command: '/browser backend <playwright|native-chrome>', description: 'select the browser backend for future browser runs' },
      { command: '/browser endpoint <url>', description: 'set the native Chrome CDP endpoint' },
      { command: '/browser launch-native [url]', description: 'launch the selected native Chrome profile with CDP enabled' },
      { command: '/browser check-native', description: 'check whether the native Chrome CDP endpoint is reachable' },
      { command: '/browser channel <chromium|chrome|msedge>', description: 'select the browser channel for future browser runs' },
      { command: '/browser open-profile [url]', description: 'open the selected Heddle-owned browser profile for manual login' },
      { command: '/browser close-profile', description: 'close the selected manual browser profile window' },
    ],
    commands: [
      {
        id: 'browser.status',
        syntax: '/browser',
        description: 'show Browser Automation status',
        match: SlashCommandParser.matchesAnyExact(['/browser', '/browser status']),
        run: (context) => browserStatusMessage(context),
      },
      {
        id: 'browser.enable',
        syntax: '/browser enable',
        description: 'enable Browser Automation guidance and browser tools for this workspace',
        match: SlashCommandParser.matchesExact('/browser enable'),
        run: (context) => setBrowserAutomationMessage(context, true),
      },
      {
        id: 'browser.disable',
        syntax: '/browser disable',
        description: 'disable Browser Automation guidance and browser tools for this workspace',
        match: SlashCommandParser.matchesExact('/browser disable'),
        run: (context) => setBrowserAutomationMessage(context, false),
      },
      {
        id: 'browser.headed',
        syntax: '/browser headed',
        description: 'run Browser Automation in a visible browser window',
        match: SlashCommandParser.matchesExact('/browser headed'),
        run: (context) => setBrowserDisplayModeMessage(context, false),
      },
      {
        id: 'browser.headless',
        syntax: '/browser headless',
        description: 'run Browser Automation without showing a browser window',
        match: SlashCommandParser.matchesExact('/browser headless'),
        run: (context) => setBrowserDisplayModeMessage(context, true),
      },
      {
        id: 'browser.profile',
        syntax: '/browser profile <id>',
        description: 'select the Heddle-owned browser profile for future browser runs',
        match: SlashCommandParser.matchesPrefix('/browser profile'),
        run: (context, input) => setBrowserProfileMessage(context, input.rest.replace(/^profile\s*/, '').trim()),
      },
      {
        id: 'browser.channel',
        syntax: '/browser channel <chromium|chrome|msedge>',
        description: 'select the browser channel for future browser runs',
        match: SlashCommandParser.matchesPrefix('/browser channel'),
        run: (context, input) => setBrowserChannelMessage(context, input.rest.replace(/^channel\s*/, '').trim()),
      },
      {
        id: 'browser.backend',
        syntax: '/browser backend <playwright|native-chrome>',
        description: 'select the browser backend for future browser runs',
        match: SlashCommandParser.matchesPrefix('/browser backend'),
        run: (context, input) => setBrowserBackendMessage(context, input.rest.replace(/^backend\s*/, '').trim()),
      },
      {
        id: 'browser.endpoint',
        syntax: '/browser endpoint <url>',
        description: 'set the native Chrome CDP endpoint',
        match: SlashCommandParser.matchesPrefix('/browser endpoint'),
        run: (context, input) => setBrowserEndpointMessage(context, input.rest.replace(/^endpoint\s*/, '').trim()),
      },
      {
        id: 'browser.launch-native',
        syntax: '/browser launch-native [url]',
        description: 'launch the selected native Chrome profile with CDP enabled',
        match: SlashCommandParser.matchesPrefix('/browser launch-native'),
        run: (context, input) => launchNativeChromeMessage(context, input.rest.replace(/^launch-native\s*/, '').trim()),
      },
      {
        id: 'browser.check-native',
        syntax: '/browser check-native',
        description: 'check whether the native Chrome CDP endpoint is reachable',
        match: SlashCommandParser.matchesExact('/browser check-native'),
        run: (context) => checkNativeChromeMessage(context),
      },
      {
        id: 'browser.open-profile',
        syntax: '/browser open-profile [url]',
        description: 'open the selected Heddle-owned browser profile for manual login',
        match: SlashCommandParser.matchesPrefix('/browser open-profile'),
        run: (context, input) => openBrowserProfileWindowMessage(context, input.rest.replace(/^open-profile\s*/, '').trim()),
      },
      {
        id: 'browser.close-profile',
        syntax: '/browser close-profile',
        description: 'close the selected manual browser profile window',
        match: SlashCommandParser.matchesExact('/browser close-profile'),
        run: (context) => closeBrowserProfileWindowMessage(context),
      },
    ],
  };
}

export async function browserStatusMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
): Promise<SlashCommandResult> {
  const overview = await context.browserAutomation.overview();
  return slashMessageResult(formatBrowserAutomationStatus(overview));
}

async function setBrowserAutomationMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  enabled: boolean,
): Promise<SlashCommandResult> {
  const result = await context.browserAutomation.setEnabled(enabled);
  if (!result.ok) {
    return slashMessageResult(`Browser Automation built-in skill was not found: ${result.overview.skillName}`);
  }

  return slashMessageResult([
    enabled
      ? 'Browser Automation guidance and browser tools are enabled for future default agent turns in this workspace.'
      : 'Browser Automation guidance and browser tools are disabled for future default agent turns in this workspace.',
    '',
    formatBrowserAutomationStatus(result.overview),
  ].join('\n'));
}

async function setBrowserDisplayModeMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  headless: boolean,
): Promise<SlashCommandResult> {
  const result = await context.browserAutomation.updateSettings({ headless });
  if (!result.ok) {
    return slashMessageResult(result.error);
  }

  return slashMessageResult([
    `Browser Automation will run in ${result.settings.displayMode} mode for future browser sessions.`,
    '',
    formatBrowserAutomationSettings(result.settings),
  ].join('\n'));
}

async function setBrowserProfileMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  profileId: string,
): Promise<SlashCommandResult> {
  if (!profileId) {
    return slashMessageResult('Usage: /browser profile <id>');
  }

  const result = await context.browserAutomation.updateSettings({ profileId });
  if (!result.ok) {
    return slashMessageResult(result.error);
  }

  return slashMessageResult([
    `Browser Automation profile set to "${result.settings.profileId}".`,
    '',
    formatBrowserAutomationSettings(result.settings),
  ].join('\n'));
}

async function setBrowserChannelMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  channel: string,
): Promise<SlashCommandResult> {
  if (!isBrowserChannel(channel)) {
    return slashMessageResult('Usage: /browser channel <chromium|chrome|msedge>');
  }

  const result = await context.browserAutomation.updateSettings({ channel });
  if (!result.ok) {
    return slashMessageResult(result.error);
  }

  return slashMessageResult([
    `Browser Automation channel set to "${result.settings.channelSelection}".`,
    '',
    formatBrowserAutomationSettings(result.settings),
  ].join('\n'));
}

async function setBrowserBackendMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  backendInput: string,
): Promise<SlashCommandResult> {
  const backend = normalizeBrowserBackend(backendInput);
  if (!backend) {
    return slashMessageResult('Usage: /browser backend <playwright|native-chrome>');
  }

  const result = await context.browserAutomation.updateSettings({ backend });
  if (!result.ok) {
    return slashMessageResult(result.error);
  }

  return slashMessageResult([
    `Browser Automation backend set to "${result.settings.backendSelection}".`,
    '',
    formatBrowserAutomationSettings(result.settings),
  ].join('\n'));
}

async function setBrowserEndpointMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  endpoint: string,
): Promise<SlashCommandResult> {
  if (!endpoint) {
    return slashMessageResult('Usage: /browser endpoint <http://127.0.0.1:port>');
  }

  const result = await context.browserAutomation.updateSettings({ cdpEndpoint: endpoint });
  if (!result.ok) {
    return slashMessageResult(result.error);
  }

  return slashMessageResult([
    `Native Chrome CDP endpoint set to "${result.settings.cdpEndpoint}".`,
    '',
    formatBrowserAutomationSettings(result.settings),
  ].join('\n'));
}

async function launchNativeChromeMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  url: string,
): Promise<SlashCommandResult> {
  const result = await context.browserAutomation.launchNativeChrome({ url: url || undefined });
  if (!result.ok) {
    return slashMessageResult([
      result.error,
      '',
      formatNativeChromeStatus(result.status),
    ].join('\n'));
  }

  return slashMessageResult([
    result.reusedExisting
      ? 'Native Chrome CDP endpoint is already reachable. Reusing the open Chrome window.'
      : 'Launched native Chrome with CDP enabled.',
    `startUrl=${result.startUrl}`,
    result.launchCommand ? `command=${result.launchCommand}` : undefined,
    '',
    formatNativeChromeStatus(result.status),
    '',
    'Keep that Chrome window open while asking the agent to use Browser Automation.',
  ].filter(Boolean).join('\n'));
}

async function checkNativeChromeMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
): Promise<SlashCommandResult> {
  const status = await context.browserAutomation.nativeChromeStatus();
  return slashMessageResult(formatNativeChromeStatus(status));
}

async function openBrowserProfileWindowMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
  url: string,
): Promise<SlashCommandResult> {
  const result = await context.browserAutomation.openProfileWindow({ url: url || undefined });
  if (!result.ok) {
    return slashMessageResult(result.error);
  }

  return slashMessageResult([
    `Opened Browser Automation profile "${result.status.profileId}" in a visible browser window.`,
    result.status.currentUrl ? `url=${result.status.currentUrl}` : undefined,
    `profilePath=${result.status.userDataDir}`,
    'Close it with /browser close-profile when you are done logging in or managing the session.',
  ].filter(Boolean).join('\n'));
}

async function closeBrowserProfileWindowMessage(
  context: Pick<SlashCommandExecutionContext, 'browserAutomation'>,
): Promise<SlashCommandResult> {
  const result = await context.browserAutomation.closeProfileWindow();
  if (!result.ok) {
    return slashMessageResult(result.error);
  }

  return slashMessageResult(`Closed Browser Automation profile window for "${result.status.profileId}".`);
}

function formatBrowserAutomationStatus(
  overview: Awaited<ReturnType<SlashCommandExecutionContext['browserAutomation']['overview']>>,
): string {
  return [
    'Browser Automation',
    `status=${overview.enabled ? 'enabled' : 'disabled'}`,
    `skill=${overview.skillName}`,
    `skillStatus=${overview.skill?.status ?? 'missing'}`,
    `activationStore=${overview.activationStorePath}`,
    '',
    formatBrowserAutomationSettings(overview.browserSettings),
    formatBrowserProfileWindowStatus(overview.profileWindow),
    formatNativeChromeStatus(overview.nativeChrome),
    '',
    overview.profileRequirement,
    overview.toolAvailability,
    '',
    'Commands',
    '  /browser enable',
    '  /browser disable',
    '  /browser headed',
    '  /browser headless',
    '  /browser profile <id>',
    '  /browser backend <playwright|native-chrome>',
    '  /browser endpoint <url>',
    '  /browser launch-native [url]',
    '  /browser check-native',
    '  /browser channel <chromium|chrome|msedge>',
    '  /browser open-profile [url]',
    '  /browser close-profile',
  ].join('\n');
}

function formatBrowserAutomationSettings(
  settings: Awaited<ReturnType<SlashCommandExecutionContext['browserAutomation']['overview']>>['browserSettings'],
): string {
  return [
    'Browser profile',
    `  profile=${settings.profileId}`,
    `  backend=${settings.backendSelection}`,
    `  channel=${settings.channelSelection}`,
    settings.cdpEndpoint ? `  cdpEndpoint=${settings.cdpEndpoint}` : undefined,
    `  mode=${settings.displayMode}`,
    `  profilePath=${settings.userDataDir}`,
    `  settings=${settings.settingsStorePath}`,
    `  knownProfiles=${settings.profiles.length}`,
  ].filter(Boolean).join('\n');
}

function formatNativeChromeStatus(
  status: Awaited<ReturnType<SlashCommandExecutionContext['browserAutomation']['nativeChromeStatus']>>,
): string {
  return [
    'Native Chrome CDP',
    `  status=${status.state}`,
    `  endpoint=${status.endpoint}`,
    `  profile=${status.profileId}`,
    `  profilePath=${status.userDataDir}`,
    `  defaultStartUrl=${status.defaultStartUrl}`,
    status.browser ? `  browser=${status.browser}` : undefined,
  ].filter(Boolean).join('\n');
}

function isBrowserChannel(channel: string): channel is typeof BROWSER_CHANNELS[number] {
  return BROWSER_CHANNELS.includes(channel as typeof BROWSER_CHANNELS[number]);
}

function normalizeBrowserBackend(backend: string): BrowserSlashBackend | undefined {
  const normalized = backend.trim();
  const aliases: Record<string, BrowserSlashBackend> = {
    playwright: 'playwright-managed',
    'playwright-managed': 'playwright-managed',
    native: 'native-chrome-cdp',
    'native-chrome': 'native-chrome-cdp',
    'native-chrome-cdp': 'native-chrome-cdp',
    cdp: 'native-chrome-cdp',
  };

  return aliases[normalized];
}

function formatBrowserProfileWindowStatus(
  profileWindow: Awaited<ReturnType<SlashCommandExecutionContext['browserAutomation']['overview']>>['profileWindow'],
): string {
  return [
    'Manual profile window',
    `  status=${profileWindow.open ? 'open' : 'closed'}`,
    profileWindow.currentUrl ? `  url=${profileWindow.currentUrl}` : undefined,
  ].filter(Boolean).join('\n');
}
