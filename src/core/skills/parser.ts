import { parse as parseYaml } from 'yaml';
import type {
  AgentSkillCatalogEntry,
  AgentSkillMetadata,
  AgentSkillResourceLink,
  AgentSkillSourceKind,
} from './types.js';

const ALLOWED_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'allowed-tools',
  'metadata',
]);

const MAX_SKILL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;

type ParsedSkill = {
  properties: {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string;
    metadata?: AgentSkillMetadata;
  };
  body: string;
};

/**
 * Heddle-owned parser for the small Agent Skills `SKILL.md` contract.
 *
 * It intentionally delegates only YAML parsing to the mature `yaml` package so
 * Heddle owns validation, prompt disclosure, and compatibility semantics.
 */
export class AgentSkillParser {
  static parse(content: string): ParsedSkill {
    const { frontmatter, body } = AgentSkillParser.splitFrontmatter(content);
    const parsed = parseYaml(frontmatter) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Agent Skill frontmatter must be a YAML object.');
    }

    const raw = parsed as Record<string, unknown>;
    const unknownKeys = Object.keys(raw).filter((key) => !ALLOWED_FRONTMATTER_KEYS.has(key));
    if (unknownKeys.length > 0) {
      throw new Error(`Unsupported Agent Skill frontmatter field(s): ${unknownKeys.join(', ')}.`);
    }

    const name = AgentSkillParser.requiredString(raw.name, 'name');
    const description = AgentSkillParser.requiredString(raw.description, 'description');
    AgentSkillParser.validateName(name);
    AgentSkillParser.validateMaxLength(description, MAX_DESCRIPTION_LENGTH, 'description');

    const compatibility = AgentSkillParser.optionalString(raw.compatibility, 'compatibility');
    if (compatibility) {
      AgentSkillParser.validateMaxLength(compatibility, MAX_COMPATIBILITY_LENGTH, 'compatibility');
    }

    return {
      properties: {
        name,
        description,
        license: AgentSkillParser.optionalString(raw.license, 'license'),
        compatibility,
        allowedTools: AgentSkillParser.optionalString(raw['allowed-tools'], 'allowed-tools'),
        metadata: AgentSkillParser.metadata(raw.metadata),
      },
      body,
    };
  }

  static toCatalogEntry(args: {
    content: string;
    skillFilePath: string;
    skillRootPath: string;
    source: AgentSkillSourceKind;
  }): AgentSkillCatalogEntry {
    const parsed = AgentSkillParser.parse(args.content);
    return {
      ...parsed.properties,
      skillFilePath: args.skillFilePath,
      skillRootPath: args.skillRootPath,
      source: args.source,
    };
  }

  static extractResourceLinks(body: string): AgentSkillResourceLink[] {
    const links = Array.from(body.matchAll(/\[([^\]]+)]\(([^)]+)\)/g))
      .map((match) => ({
        name: match[1]?.trim() ?? '',
        path: AgentSkillParser.normalizedResourcePath(match[2]?.trim() ?? ''),
      }))
      .filter((link): link is AgentSkillResourceLink => Boolean(link.name) && Boolean(link.path));

    return Array.from(
      new Map(links.map((link) => [`${link.name}\0${link.path}`, link])).values(),
    );
  }

  static formatCatalogPrompt(args: {
    skills: AgentSkillCatalogEntry[];
    readToolName: string;
  }): string {
    return [
      `Agent Skills are available through progressive disclosure. Use ${args.readToolName} with a skill name when a skill is relevant; do not assume full skill instructions are already in context.`,
      '<available_skills>',
      ...args.skills.map((skill) => [
        '<skill>',
        `<name>${AgentSkillParser.escapeXml(skill.name)}</name>`,
        `<description>${AgentSkillParser.escapeXml(skill.description)}</description>`,
        `<location>${AgentSkillParser.escapeXml(skill.skillFilePath)}</location>`,
        '</skill>',
      ].join('\n')),
      '</available_skills>',
    ].join('\n');
  }

  private static splitFrontmatter(content: string): {
    frontmatter: string;
    body: string;
  } {
    const normalized = content.replace(/^\uFEFF/, '');
    if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
      throw new Error('Agent Skill must start with YAML frontmatter.');
    }

    const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      throw new Error('Agent Skill frontmatter must close with --- on its own line.');
    }

    return {
      frontmatter: match[1] ?? '',
      body: (match[2] ?? '').trim(),
    };
  }

  private static requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Agent Skill frontmatter requires non-empty string field "${field}".`);
    }

    return value.trim();
  }

  private static optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new Error(`Agent Skill frontmatter field "${field}" must be a string.`);
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private static validateName(name: string): void {
    AgentSkillParser.validateMaxLength(name, MAX_SKILL_NAME_LENGTH, 'name');

    if (name !== name.normalize('NFKC')) {
      throw new Error('Agent Skill name must use normalized Unicode.');
    }

    if (name !== name.toLocaleLowerCase()) {
      throw new Error('Agent Skill name must be lowercase.');
    }

    if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
      throw new Error('Agent Skill name cannot start, end, or repeat hyphens.');
    }

    if (!/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}-]*$/u.test(name)) {
      throw new Error('Agent Skill name can contain only letters, numbers, and hyphens.');
    }
  }

  private static validateMaxLength(value: string, maxLength: number, field: string): void {
    if (value.length > maxLength) {
      throw new Error(`Agent Skill frontmatter field "${field}" must be ${maxLength} characters or fewer.`);
    }
  }

  private static metadata(value: unknown): AgentSkillMetadata | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Agent Skill frontmatter field "metadata" must be an object.');
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
        if (entryValue === undefined || entryValue === null || typeof entryValue === 'object') {
          throw new Error(`Agent Skill metadata field "${key}" must be a scalar value.`);
        }

        return [key, String(entryValue)];
      }),
    );
  }

  private static normalizedResourcePath(path: string): string | undefined {
    const normalized = path.replace(/^\.\//, '');
    if (
      normalized.startsWith('../') ||
      normalized.startsWith('/') ||
      normalized.startsWith('#') ||
      /^[a-z]+:/i.test(normalized)
    ) {
      return undefined;
    }

    return ['scripts/', 'references/', 'assets/'].some((prefix) => normalized.startsWith(prefix))
      ? normalized
      : undefined;
  }

  private static escapeXml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }
}
