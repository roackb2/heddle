import { SlashCommandParser } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { slashMessageResult } from '../results.js';

const BROWSER_CHANNELS = ['chromium', 'chrome', 'msedge'] as const;

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
    `  channel=${settings.channelSelection}`,
    `  mode=${settings.displayMode}`,
    `  profilePath=${settings.userDataDir}`,
    `  settings=${settings.settingsStorePath}`,
    `  knownProfiles=${settings.profiles.length}`,
  ].join('\n');
}

function isBrowserChannel(channel: string): channel is typeof BROWSER_CHANNELS[number] {
  return BROWSER_CHANNELS.includes(channel as typeof BROWSER_CHANNELS[number]);
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
