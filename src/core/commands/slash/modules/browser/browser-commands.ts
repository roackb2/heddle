import { SlashCommandParser } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { slashMessageResult } from '../results.js';

export function createBrowserSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'browser',
    hints: [
      { command: '/browser', description: 'show Browser Automation status' },
      { command: '/browser enable', description: 'enable Browser Automation guidance and browser tools for this workspace' },
      { command: '/browser disable', description: 'disable Browser Automation guidance and browser tools for this workspace' },
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
    overview.profileRequirement,
    overview.toolAvailability,
    '',
    'Commands',
    '  /browser enable',
    '  /browser disable',
  ].join('\n');
}
