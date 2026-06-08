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
  AgentSkillActivationResult,
  AgentSkillActivationStorePort,
  AgentSkillActivationView,
  AgentSkillReadResult,
  AgentSkillRoot,
  AgentSkillServiceOptions,
  AgentSkillSourceKind,
} from './types.js';

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
  private readonly builtInSkillRoots: string[];
  private readonly activationStore?: AgentSkillActivationStorePort;

  constructor(options: AgentSkillServiceOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.cwd = resolve(options.cwd ?? options.workspaceRoot);
    this.homeDir = resolve(options.homeDir ?? homedir());
    this.builtInSkillRoots = (options.builtInSkillRoots ?? []).map((root) => resolve(root));
    this.activationStore = options.activationStore;
  }

  async loadCatalog(): Promise<AgentSkillCatalog> {
    const rootResults = await Promise.all(
      this.listSkillRoots().map((root) => this.readRootCatalog(root)),
    );
    const rawEntries = rootResults.flatMap((result) => result.entries);
    const issues = rootResults.flatMap((result) => result.issues);
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

    const content = await readFile(skill.skillFilePath, 'utf8');
    const parsed = AgentSkillParser.parse(content);

    return {
      skill,
      body: parsed.body,
      resources: AgentSkillParser.extractResourceLinks(parsed.body),
    };
  }

  async loadActivatedCatalog(): Promise<AgentSkillCatalog> {
    const catalog = await this.loadCatalog();
    const activeSkillNames = new Set(
      Object.values(this.activationStore?.read().skills ?? {})
        .filter((record) => record.status === 'active')
        .map((record) => record.name),
    );

    return {
      skills: catalog.skills.filter((skill) => activeSkillNames.has(skill.name)),
      issues: catalog.issues,
    };
  }

  async listActivationViews(): Promise<AgentSkillActivationView[]> {
    const catalog = await this.loadCatalog();
    const entriesByName = new Map(catalog.skills.map((skill) => [skill.name, skill]));
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
      viewsByName.set(record.name, {
        name: record.name,
        status: entriesByName.has(record.name) ? record.status : 'missing',
        catalogEntry: entriesByName.get(record.name),
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
