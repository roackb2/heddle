import { access, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { AgentSkillParser } from './parser.js';
import type {
  AgentSkillCatalog,
  AgentSkillCatalogEntry,
  AgentSkillCatalogIssue,
  AgentSkillCatalogPromptOptions,
  AgentSkillActivationRecord,
  AgentSkillActivationOverview,
  AgentSkillActivationResult,
  AgentSkillActivationStorePort,
  AgentSkillActivationView,
  AgentSkillBuiltInDefinition,
  AgentSkillReadResult,
  AgentSkillResourceReadResult,
  AgentSkillRoot,
  AgentSkillServiceOptions,
  AgentSkillSourceKind,
} from './types.js';
import { DEFAULT_BUILT_IN_AGENT_SKILLS } from './built-ins.js';

const SKILL_FILE_NAMES = ['SKILL.md', 'skill.md'] as const;

/**
 * Owns Agent Skills discovery and progressive-disclosure metadata.
 *
 * The service reads only standard `SKILL.md` frontmatter while building a
 * catalog. Full skill instructions stay out of the agent prompt until a
 * caller explicitly reads one skill by name.
 */
export class AgentSkillService {
  private readonly workspaceRoot: string;
  private readonly cwd: string;
  private readonly homeDir: string;
  private readonly builtInSkills: AgentSkillBuiltInDefinition[];
  private readonly builtInSkillRoots: string[];
  private readonly activationStore?: AgentSkillActivationStorePort;

  constructor(options: AgentSkillServiceOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.cwd = resolve(options.cwd ?? options.workspaceRoot);
    this.homeDir = resolve(options.homeDir ?? homedir());
    this.builtInSkills = options.builtInSkills ?? DEFAULT_BUILT_IN_AGENT_SKILLS;
    this.builtInSkillRoots = (options.builtInSkillRoots ?? []).map((root) => resolve(root));
    this.activationStore = options.activationStore;
  }

  async loadCatalog(): Promise<AgentSkillCatalog> {
    const rootResults = await Promise.all(
      this.listSkillRoots().map((root) => this.readRootCatalog(root)),
    );
    const builtInResult = this.readBuiltInCatalog();
    const rawEntries = [
      ...rootResults.flatMap((result) => result.entries),
      ...builtInResult.entries,
    ];
    const issues = [
      ...rootResults.flatMap((result) => result.issues),
      ...builtInResult.issues,
    ];
    const entriesByName = new Map<string, AgentSkillCatalogEntry>();

    for (const entry of rawEntries) {
      if (entriesByName.has(entry.name)) {
        issues.push({
          code: 'duplicate_skill',
          path: entry.skillFilePath,
          message: `Ignored duplicate Agent Skill "${entry.name}" from ${entry.source}; ${entriesByName.get(entry.name)?.skillFilePath} has precedence.`,
        });
        continue;
      }

      entriesByName.set(entry.name, entry);
    }

    return {
      skills: Array.from(entriesByName.values()),
      issues,
    };
  }

  async readSkill(name: string): Promise<AgentSkillReadResult | null> {
    const catalog = await this.loadCatalog();
    const skill = catalog.skills.find((entry) => entry.name === name);

    if (!skill) {
      return null;
    }

    return await this.readSkillEntry(skill);
  }

  async readActivatedSkill(name: string): Promise<AgentSkillReadResult | null> {
    const record = this.readActivationStore().skills[name];
    if (!record || record.status !== 'active') {
      return null;
    }

    const catalog = await this.loadCatalog();
    const skill = this.resolveActivationRecordCatalogEntry(record, catalog);
    return skill ? await this.readSkillEntry(skill) : null;
  }

  async readActivatedSkillResource(name: string, resource: string): Promise<AgentSkillResourceReadResult | null> {
    const skill = await this.readActivatedSkill(name);
    const resolvedResource = skill?.resources.find((candidate) => (
      candidate.name === resource || candidate.path === resource
    ));

    if (!skill || !resolvedResource) {
      return null;
    }

    const builtInSkill = this.findBuiltInSkill(skill.skill.skillFilePath);
    if (builtInSkill) {
      const content = builtInSkill.resources?.[resolvedResource.path];
      return content === undefined ? null : {
        skill: skill.skill,
        resource: resolvedResource,
        content,
      };
    }

    const resourcePath = resolve(skill.skill.skillRootPath, resolvedResource.path);
    if (!isPathInsideRoot(resourcePath, skill.skill.skillRootPath)) {
      return null;
    }

    return {
      skill: skill.skill,
      resource: resolvedResource,
      content: await readFile(resourcePath, 'utf8'),
    };
  }

  async loadActivatedCatalog(): Promise<AgentSkillCatalog> {
    const catalog = await this.loadCatalog();
    const activeSkills = Object.values(this.activationStore?.read().skills ?? {})
      .filter((record) => record.status === 'active')
      .flatMap((record) => {
        const skill = this.resolveActivationRecordCatalogEntry(record, catalog);
        return skill ? [skill] : [];
      });

    return {
      skills: activeSkills,
      issues: catalog.issues,
    };
  }

  getBuiltInActivationView(name: string): AgentSkillActivationView | undefined {
    const skill = this.findBuiltInCatalogEntry(name);
    if (!skill) {
      return undefined;
    }

    const record = this.readActivationStore().skills[name];
    const activeRecord = record?.source === 'built-in' && record.skillFilePath === skill.skillFilePath
      ? record
      : undefined;

    return {
      name,
      status: activeRecord?.status ?? 'available',
      catalogEntry: skill,
      record: activeRecord,
    };
  }

  async activateBuiltInSkill(name: string, now = new Date()): Promise<AgentSkillActivationResult> {
    const skill = this.findBuiltInCatalogEntry(name);
    if (!skill) {
      return {
        ok: false,
        reason: 'skill_not_found',
        name,
      };
    }

    const timestamp = now.toISOString();
    const store = this.readActivationStore();
    const existing = store.skills[name];
    const existingBuiltIn = existing?.source === skill.source && existing.skillFilePath === skill.skillFilePath
      ? existing
      : undefined;
    const record: AgentSkillActivationRecord = {
      name: skill.name,
      source: skill.source,
      skillFilePath: skill.skillFilePath,
      status: 'active',
      activatedAt: existingBuiltIn?.activatedAt ?? timestamp,
      updatedAt: timestamp,
    };

    store.skills[name] = record;
    this.writeActivationStore(store);

    return {
      ok: true,
      record,
    };
  }

  private async readSkillEntry(skill: AgentSkillCatalogEntry): Promise<AgentSkillReadResult> {
    const content = this.findBuiltInSkill(skill.skillFilePath)?.content
      ?? await readFile(skill.skillFilePath, 'utf8');
    const parsed = AgentSkillParser.parse(content);

    return {
      skill,
      body: parsed.body,
      resources: AgentSkillParser.extractResourceLinks(parsed.body),
    };
  }

  private resolveActivationRecordCatalogEntry(
    record: AgentSkillActivationRecord,
    catalog: AgentSkillCatalog,
  ): AgentSkillCatalogEntry | undefined {
    return catalog.skills.find((skill) => (
      skill.name === record.name
      && skill.source === record.source
      && skill.skillFilePath === record.skillFilePath
    )) ?? (
      record.source === 'built-in'
        ? this.findBuiltInCatalogEntry(record.name, record.skillFilePath)
        : undefined
    );
  }

  async listActivationViews(): Promise<AgentSkillActivationView[]> {
    return (await this.listActivationOverview()).skills;
  }

  async listActivationOverview(): Promise<AgentSkillActivationOverview> {
    const catalog = await this.loadCatalog();
    return {
      skills: this.buildActivationViews(catalog),
      issues: catalog.issues,
    };
  }

  private buildActivationViews(catalog: AgentSkillCatalog): AgentSkillActivationView[] {
    const records = Object.values(this.activationStore?.read().skills ?? {});
    const viewsByName = new Map<string, AgentSkillActivationView>();

    for (const skill of catalog.skills) {
      viewsByName.set(skill.name, {
        name: skill.name,
        status: 'available',
        catalogEntry: skill,
      });
    }

    for (const record of records) {
      const skill = this.resolveActivationRecordCatalogEntry(record, catalog);
      viewsByName.set(record.name, {
        name: record.name,
        status: skill ? record.status : 'missing',
        catalogEntry: skill,
        record,
      });
    }

    return Array.from(viewsByName.values())
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async activateSkill(name: string, now = new Date()): Promise<AgentSkillActivationResult> {
    const catalog = await this.loadCatalog();
    const skill = catalog.skills.find((entry) => entry.name === name);

    if (!skill) {
      return {
        ok: false,
        reason: 'skill_not_found',
        name,
      };
    }

    const timestamp = now.toISOString();
    const store = this.readActivationStore();
    const existing = store.skills[name];
    const record: AgentSkillActivationRecord = {
      name: skill.name,
      source: skill.source,
      skillFilePath: skill.skillFilePath,
      status: 'active',
      activatedAt: existing?.activatedAt ?? timestamp,
      updatedAt: timestamp,
    };

    store.skills[name] = record;
    this.writeActivationStore(store);

    return {
      ok: true,
      record,
    };
  }

  async disableSkill(name: string, now = new Date()): Promise<AgentSkillActivationResult> {
    const store = this.readActivationStore();
    const existing = store.skills[name];

    if (!existing || existing.status !== 'active') {
      return {
        ok: false,
        reason: 'skill_not_active',
        name,
      };
    }

    const record: AgentSkillActivationRecord = {
      ...existing,
      status: 'disabled',
      updatedAt: now.toISOString(),
    };

    store.skills[name] = record;
    this.writeActivationStore(store);

    return {
      ok: true,
      record,
    };
  }

  formatCatalogPrompt(
    catalog: AgentSkillCatalog,
    options: AgentSkillCatalogPromptOptions = {},
  ): string {
    const readToolName = options.readToolName ?? 'read_agent_skill';
    return AgentSkillParser.formatCatalogPrompt({
      skills: catalog.skills,
      readToolName,
    });
  }

  private listSkillRoots(): AgentSkillRoot[] {
    return [
      ...this.listProjectSkillRoots(),
      { source: 'user' as const, path: join(this.homeDir, '.agents', 'skills') },
      ...this.builtInSkillRoots.map((path) => ({ source: 'built-in' as const, path })),
    ];
  }

  private listProjectSkillRoots(): AgentSkillRoot[] {
    const roots: AgentSkillRoot[] = [];
    const workspaceRoot = this.workspaceRoot;
    let current = isPathInsideRoot(this.cwd, workspaceRoot) ? this.cwd : workspaceRoot;

    while (true) {
      roots.push({ source: 'project', path: join(current, '.agents', 'skills') });

      if (current === workspaceRoot) {
        return roots;
      }

      const parent = dirname(current);
      if (parent === current) {
        return roots;
      }

      current = parent;
    }
  }

  private async readRootCatalog(root: AgentSkillRoot): Promise<{
    entries: AgentSkillCatalogEntry[];
    issues: AgentSkillCatalogIssue[];
  }> {
    const skillDirs = await this.readSkillDirectories(root);
    const skillResults = await Promise.all(
      skillDirs.entries.map((skillRootPath) => this.readCatalogEntry(root.source, skillRootPath)),
    );

    return {
      entries: skillResults.flatMap((result) => result.entry ? [result.entry] : []),
      issues: [...skillDirs.issues, ...skillResults.flatMap((result) => result.issues)],
    };
  }

  private readBuiltInCatalog(): {
    entries: AgentSkillCatalogEntry[];
    issues: AgentSkillCatalogIssue[];
  } {
    const results = this.builtInSkills.map((skill) => {
      try {
        return {
          entry: AgentSkillParser.toCatalogEntry({
            content: skill.content,
            skillFilePath: skill.skillFilePath,
            skillRootPath: skill.skillRootPath,
            source: 'built-in',
          }),
          issue: undefined,
        };
      } catch (error) {
        return {
          entry: undefined,
          issue: {
            code: 'invalid_skill' as const,
            path: skill.skillFilePath,
            message: errorMessage(error),
          },
        };
      }
    });

    return {
      entries: results.flatMap((result) => result.entry ? [result.entry] : []),
      issues: results.flatMap((result) => result.issue ? [result.issue] : []),
    };
  }

  private findBuiltInSkill(skillFilePath: string): AgentSkillBuiltInDefinition | undefined {
    return this.builtInSkills.find((skill) => skill.skillFilePath === skillFilePath);
  }

  private findBuiltInCatalogEntry(name: string, skillFilePath?: string): AgentSkillCatalogEntry | undefined {
    return this.readBuiltInCatalog().entries.find((skill) => (
      skill.name === name
      && (skillFilePath === undefined || skill.skillFilePath === skillFilePath)
    ));
  }

  private async readSkillDirectories(root: AgentSkillRoot): Promise<{
    entries: string[];
    issues: AgentSkillCatalogIssue[];
  }> {
    try {
      const dirents = await readdir(root.path, { withFileTypes: true });
      return {
        entries: dirents
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => join(root.path, dirent.name))
          .sort(),
        issues: [],
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { entries: [], issues: [] };
      }

      return {
        entries: [],
        issues: [{
          code: 'unreadable_root',
          path: root.path,
          message: errorMessage(error),
        }],
      };
    }
  }

  private async readCatalogEntry(source: AgentSkillSourceKind, skillRootPath: string): Promise<{
    entry?: AgentSkillCatalogEntry;
    issues: AgentSkillCatalogIssue[];
  }> {
    const skillFile = await this.findSkillFile(skillRootPath);

    if (skillFile.issue) {
      return { issues: [skillFile.issue] };
    }

    if (!skillFile.path) {
      return { issues: [] };
    }

    try {
      const content = await readFile(skillFile.path, 'utf8');
      const entry = AgentSkillParser.toCatalogEntry({
        content,
        skillFilePath: skillFile.path,
        skillRootPath,
        source,
      });

      return {
        entry,
        issues: [],
      };
    } catch (error) {
      return {
        issues: [{
          code: 'invalid_skill',
          path: skillFile.path,
          message: errorMessage(error),
        }],
      };
    }
  }

  private async findSkillFile(skillRootPath: string): Promise<{
    path?: string;
    issue?: AgentSkillCatalogIssue;
  }> {
    for (const fileName of SKILL_FILE_NAMES) {
      const skillFilePath = join(skillRootPath, fileName);
      try {
        await access(skillFilePath);
        return { path: skillFilePath };
      } catch (error) {
        if (!isNotFoundError(error)) {
          return {
            issue: {
              code: 'unreadable_skill',
              path: skillFilePath,
              message: errorMessage(error),
            },
          };
        }
      }
    }

    return {};
  }

  private readActivationStore() {
    return this.activationStore?.read() ?? {
      version: 1 as const,
      skills: {},
    };
  }

  private writeActivationStore(store: ReturnType<AgentSkillService['readActivationStore']>): void {
    if (!this.activationStore) {
      throw new Error('Agent Skill activation store is required to persist activation changes.');
    }

    this.activationStore.write(store);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isPathInsideRoot(path: string, root: string): boolean {
  const relativePath = relative(resolve(root), resolve(path));
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}
