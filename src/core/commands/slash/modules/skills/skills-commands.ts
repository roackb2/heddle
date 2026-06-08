import { SlashCommandParser } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { AgentSkillActivationView } from '@/core/skills/index.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, slashMessageResult } from '../results.js';

const SKILL_LIST_SECTIONS: {
  status: AgentSkillActivationView['status'];
  title: string;
  empty: string;
}[] = [
  { status: 'active', title: 'Active', empty: 'none' },
  { status: 'available', title: 'Available', empty: 'none' },
  { status: 'disabled', title: 'Disabled', empty: 'none' },
  { status: 'missing', title: 'Missing definitions', empty: 'none' },
];

const SKILL_STATUS_ACTIONS = new Map<AgentSkillActivationView['status'], (name: string) => string>([
  ['active', (name) => `/skills disable ${name}`],
  ['available', (name) => `/skills enable ${name}`],
  ['disabled', (name) => `/skills enable ${name}`],
  ['missing', () => 'restore SKILL.md or disable the stale activation record'],
]);

export function createSkillsSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'skills',
    hints: [
      { command: '/skills', description: 'list Agent Skills and activation status' },
      { command: '/skills enable <name>', description: 'activate one Agent Skill for this workspace' },
      { command: '/skills disable <name>', description: 'disable one Agent Skill for this workspace' },
    ],
    commands: [
      {
        id: 'skills.list',
        syntax: '/skills',
        description: 'list Agent Skills and activation status',
        match: SlashCommandParser.matchesExact('/skills'),
        run: (context) => listSkillsMessage(context),
      },
      {
        id: 'skills.enable',
        syntax: '/skills enable <name>',
        description: 'activate one Agent Skill for this workspace',
        match: matchesRequiredSkillArgument('/skills enable'),
        run: (context, input) => enableSkillMessage(context, argumentAfterPrefix(input, '/skills enable')),
      },
      {
        id: 'skills.disable',
        syntax: '/skills disable <name>',
        description: 'disable one Agent Skill for this workspace',
        match: matchesRequiredSkillArgument('/skills disable'),
        run: (context, input) => disableSkillMessage(context, argumentAfterPrefix(input, '/skills disable')),
      },
    ],
  };
}

export async function listSkillsMessage(
  context: Pick<SlashCommandExecutionContext, 'skills'>,
): Promise<SlashCommandResult> {
  const skills = await context.skills.list();
  if (!skills.length) {
    return slashMessageResult('No Agent Skills found. Add skills under .agents/skills/<name>/SKILL.md or ~/.agents/skills/<name>/SKILL.md.');
  }

  return slashMessageResult([
    'Agent Skills',
    '',
    ...SKILL_LIST_SECTIONS.map((section) => formatSkillSection(section, skills)),
    '',
    'Commands',
    '  /skills enable <name>',
    '  /skills disable <name>',
  ].join('\n'));
}

async function enableSkillMessage(
  context: Pick<SlashCommandExecutionContext, 'skills'>,
  value: string,
): Promise<SlashCommandResult> {
  const name = value.trim();
  const result = await context.skills.activate(name);
  return result.ok
    ? slashMessageResult(`Activated Agent Skill ${result.record.name}. It will be available to future agent turns in this workspace.`)
    : slashMessageResult(`Agent Skill not found: ${result.name}`);
}

async function disableSkillMessage(
  context: Pick<SlashCommandExecutionContext, 'skills'>,
  value: string,
): Promise<SlashCommandResult> {
  const name = value.trim();
  const result = await context.skills.disable(name);
  return result.ok
    ? slashMessageResult(`Disabled Agent Skill ${result.record.name}. It will not be shown to future agent turns.`)
    : slashMessageResult(`Agent Skill is not active: ${result.name}`);
}

function formatSkillListItem(view: AgentSkillActivationView): string {
  const description = view.catalogEntry?.description ?? 'skill definition is missing';
  const source = view.catalogEntry?.source ?? view.record?.source;
  const action = SKILL_STATUS_ACTIONS.get(view.status)?.(view.name);
  return [
    `- ${view.name}`,
    `  ${description}`,
    source ? `  source=${source}` : undefined,
    action ? `  action=${action}` : undefined,
  ].filter((line): line is string => line !== undefined).join('\n');
}

function formatSkillSection(
  section: typeof SKILL_LIST_SECTIONS[number],
  skills: AgentSkillActivationView[],
): string {
  const sectionSkills = skills.filter((view) => view.status === section.status);
  return [
    `${section.title} (${sectionSkills.length})`,
    ...(sectionSkills.length > 0 ? sectionSkills.map(formatSkillListItem) : [`  ${section.empty}`]),
  ].join('\n');
}

function matchesRequiredSkillArgument(prefix: string): (input: { raw: string }) => boolean {
  return (input) => input.raw.startsWith(`${prefix} `) && input.raw.slice(prefix.length).trim().length > 0;
}
