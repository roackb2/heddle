import { readFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AgentSkillBuiltInDefinition } from './types.js';

export const BROWSER_AUTOMATION_SKILL_NAME = 'browser-automation';

export const BROWSER_AUTOMATION_SKILL_ROOT = `heddle://built-in-skills/${BROWSER_AUTOMATION_SKILL_NAME}`;
export const BROWSER_AUTOMATION_SKILL_FILE_PATH = `${BROWSER_AUTOMATION_SKILL_ROOT}/SKILL.md`;
const BROWSER_AUTOMATION_SKILL_YAML = new URL('./browser-automation.skill.yaml', import.meta.url);

export const DEFAULT_BUILT_IN_AGENT_SKILLS: AgentSkillBuiltInDefinition[] = [
  readBuiltInSkillYaml({
    skillRootPath: BROWSER_AUTOMATION_SKILL_ROOT,
    skillFilePath: BROWSER_AUTOMATION_SKILL_FILE_PATH,
    yamlUrl: BROWSER_AUTOMATION_SKILL_YAML,
  }),
];

function readBuiltInSkillYaml(args: {
  skillRootPath: string;
  skillFilePath: string;
  yamlUrl: URL;
}): AgentSkillBuiltInDefinition {
  const parsed = parseYaml(readFileSync(args.yamlUrl, 'utf8')) as unknown;
  if (!isBuiltInSkillYaml(parsed)) {
    throw new Error(`Invalid built-in Agent Skill YAML: ${args.yamlUrl.toString()}`);
  }

  // Built-in skills live as YAML assets for maintainability, while the skills
  // domain continues to consume standard SKILL.md frontmatter content.
  const frontmatter = stringifyYaml(Object.fromEntries([
    ['name', parsed.name],
    ['description', parsed.description],
    ['license', parsed.license],
    ['compatibility', parsed.compatibility],
    ['allowed-tools', parsed['allowed-tools']],
    ['metadata', parsed.metadata],
  ].filter((entry): entry is [string, string | Record<string, string>] => entry[1] !== undefined))).trimEnd();

  return {
    skillRootPath: args.skillRootPath,
    skillFilePath: args.skillFilePath,
    content: [
      '---',
      frontmatter,
      '---',
      parsed.body,
    ].join('\n'),
    resources: parsed.resources,
  };
}

function isBuiltInSkillYaml(raw: unknown): raw is {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
  resources?: Record<string, string>;
  body: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const value = raw as Record<string, unknown>;
  return typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.body === 'string'
    && optionalRecord(value.metadata)
    && optionalRecord(value.resources)
    && ['license', 'compatibility', 'allowed-tools'].every((key) => (
      value[key] === undefined || typeof value[key] === 'string'
    ));
}

function optionalRecord(value: unknown): value is Record<string, string> | undefined {
  return value === undefined || (
    Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string')
  );
}
