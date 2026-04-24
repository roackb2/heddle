import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildMemoryDomainSystemContext } from './domain-prompt.js';

export const DEFAULT_MEMORY_ROOT_CATALOG_MAX_BYTES = 12 * 1024;
export const DEFAULT_MEMORY_ROOT_CATALOG_TARGET_BYTES = 8 * 1024;
export const DEFAULT_MEMORY_FOLDER_CATALOG_MAX_BYTES = 8 * 1024;
export const DEFAULT_MEMORY_FOLDER_CATALOG_TARGET_BYTES = 5 * 1024;

export type MemoryCategory = {
  path: string;
  title: string;
  purpose: string;
  readWhen: string;
};

export type BootstrapMemoryWorkspaceResult = {
  memoryRoot: string;
  createdPaths: string[];
};

export type MemoryCatalogLoadResult = {
  memoryRoot: string;
  catalogPath: string;
  exists: boolean;
  content: string;
  truncated: boolean;
  originalBytes: number;
  maxBytes: number;
};

export type MemoryCatalogShapeValidation = {
  ok: boolean;
  memoryRoot: string;
  missing: string[];
};

export const DEFAULT_MEMORY_CATEGORIES: MemoryCategory[] = [
  {
    path: 'current-state',
    title: 'Current State',
    purpose: 'Fresh-session summary, active workstreams, blockers, and recent verified changes.',
    readWhen: 'Start here for non-trivial work or when the user asks what is happening now.',
  },
  {
    path: 'workflows',
    title: 'Workflows',
    purpose: 'Procedures for planning, implementation, review, release, incident, and support work.',
    readWhen: 'Use when the task is process-heavy or the user asks you to follow an established workflow.',
  },
  {
    path: 'preferences',
    title: 'Preferences',
    purpose: 'User or team preferences that should shape communication, code style, risk tolerance, and review behavior.',
    readWhen: 'Use before making broad implementation, design, communication, or review choices.',
  },
  {
    path: 'domain',
    title: 'Domain',
    purpose: 'Durable project, product, architecture, service, data, or business-domain knowledge.',
    readWhen: 'Use before answering architecture questions or changing unfamiliar project behavior.',
  },
  {
    path: 'operations',
    title: 'Operations',
    purpose: 'Commands, environments, deployment/release surfaces, operational status, credentials caveats, and safety notes.',
    readWhen: 'Use before running verification, deployment, migration, incident, or environment-sensitive work.',
  },
  {
    path: 'relationships',
    title: 'Relationships',
    purpose: 'People, teams, systems, projects, ownership, dependencies, escalation paths, and schedules.',
    readWhen: 'Use when work depends on ownership, coordination, external systems, stakeholders, or timing.',
  },
  {
    path: 'history',
    title: 'History',
    purpose: 'Completed decisions, incidents, investigations, migrations, and older context that explains current constraints.',
    readWhen: 'Use when current behavior has historical causes or the task resembles a past incident or decision.',
  },
];

export function bootstrapMemoryWorkspace(options: { memoryRoot: string }): BootstrapMemoryWorkspaceResult {
  const memoryRoot = resolve(options.memoryRoot);
  const createdPaths: string[] = [];

  mkdirSync(memoryRoot, { recursive: true });
  writeIfMissing(join(memoryRoot, 'README.md'), createRootCatalogTemplate(), createdPaths, memoryRoot);

  for (const category of DEFAULT_MEMORY_CATEGORIES) {
    const categoryRoot = join(memoryRoot, category.path);
    mkdirSync(categoryRoot, { recursive: true });
    writeIfMissing(join(categoryRoot, 'README.md'), createFolderCatalogTemplate(category), createdPaths, memoryRoot);
  }

  mkdirSync(join(memoryRoot, '_maintenance'), { recursive: true });
  writeIfMissing(join(memoryRoot, '_maintenance', 'runs.jsonl'), '', createdPaths, memoryRoot);

  return { memoryRoot, createdPaths };
}

export function loadMemoryRootCatalog(options: {
  memoryRoot: string;
  maxBytes?: number;
}): MemoryCatalogLoadResult {
  const memoryRoot = resolve(options.memoryRoot);
  const maxBytes = options.maxBytes ?? DEFAULT_MEMORY_ROOT_CATALOG_MAX_BYTES;
  const catalogPath = join(memoryRoot, 'README.md');

  if (!existsSync(catalogPath)) {
    const content = [
      'No workspace memory catalog exists yet.',
      '',
      `Expected root catalog: ${catalogPath}`,
      '',
      'Memory remains available through list/read/search tools when notes exist, but startup recall is not initialized.',
      'Initialize a cataloged memory workspace before relying on durable recall.',
    ].join('\n');

    return {
      memoryRoot,
      catalogPath,
      exists: false,
      content,
      truncated: false,
      originalBytes: Buffer.byteLength(content, 'utf8'),
      maxBytes,
    };
  }

  const original = readFileSync(catalogPath, 'utf8').trim();
  const originalBytes = Buffer.byteLength(original, 'utf8');
  const truncatedContent = truncateUtf8(original, maxBytes);
  const truncated = originalBytes > Buffer.byteLength(truncatedContent, 'utf8');
  const content =
    truncated ?
      [
        truncatedContent,
        '',
        `[Memory catalog truncated to ${maxBytes} bytes from ${originalBytes} bytes. Use read_memory_note on README.md for the full catalog.]`,
      ].join('\n')
    : original;

  return {
    memoryRoot,
    catalogPath,
    exists: true,
    content,
    truncated,
    originalBytes,
    maxBytes,
  };
}

export function formatMemoryCatalogSystemContext(catalog: MemoryCatalogLoadResult): string {
  const header = catalog.exists ? '## Workspace Memory Catalog' : '## Workspace Memory Catalog Missing';
  return [
    header,
    '',
    `Source: ${catalog.catalogPath}`,
    '',
    catalog.content,
    '',
    'Startup memory policy: this is the only memory document loaded automatically. Use memory tools to read relevant folder catalogs or notes before relying on deeper memory.',
  ].join('\n');
}

export function appendMemoryCatalogSystemContext(options: {
  systemContext?: string;
  memoryRoot: string;
  maxBytes?: number;
}): string {
  const catalog = loadMemoryRootCatalog({ memoryRoot: options.memoryRoot, maxBytes: options.maxBytes });
  const memoryContext = formatMemoryCatalogSystemContext(catalog);
  const domainContext = buildMemoryDomainSystemContext();
  const context = `${domainContext}\n\n${memoryContext}`;
  return options.systemContext ? `${options.systemContext}\n\n${context}` : context;
}

export function validateMemoryCatalogShape(options: { memoryRoot: string }): MemoryCatalogShapeValidation {
  const memoryRoot = resolve(options.memoryRoot);
  const requiredPaths = [
    'README.md',
    ...DEFAULT_MEMORY_CATEGORIES.map((category) => join(category.path, 'README.md')),
  ];
  const missing = requiredPaths.filter((relativePath) => !existsSync(join(memoryRoot, relativePath)));
  return {
    ok: missing.length === 0,
    memoryRoot,
    missing,
  };
}

function writeIfMissing(path: string, content: string, createdPaths: string[], memoryRoot: string) {
  if (existsSync(path)) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  createdPaths.push(toMemoryRelativePath(memoryRoot, path));
}

function createRootCatalogTemplate(): string {
  return [
    '# Workspace Memory',
    '',
    'Purpose: durable workspace knowledge that helps future agents become operational quickly.',
    '',
    '## Authority And Freshness',
    '',
    '- Live workspace evidence wins over memory when they disagree.',
    '- Current-state notes with recent verification are stronger than older focused notes.',
    '- Historical notes explain decisions and incidents but may be stale.',
    '- Important stale, disputed, or superseded facts should be marked rather than silently removed.',
    '',
    '## Fast Reading Path',
    '',
    '- New non-trivial task: read `current-state/README.md`, then the category that matches the task.',
    '- Coding or architecture task: read `domain/README.md`, `operations/README.md`, and relevant preferences.',
    '- Workflow, release, PR, or incident task: read `workflows/README.md`, `operations/README.md`, and relevant history.',
    '- Coordination-heavy task: read `relationships/README.md`.',
    '',
    '## Category Index',
    '',
    ...DEFAULT_MEMORY_CATEGORIES.map((category) => `- [${category.title}](${category.path}/README.md): ${category.purpose}`),
    '',
    '## High-Value Notes',
    '',
    '- Add links here when notes become important enough for every fresh agent to notice.',
    '',
    '## Stale Or Disputed Notes',
    '',
    '- Add links here when a note should be treated with caution.',
    '',
    '## Maintenance Instructions',
    '',
    '- Keep this catalog short and navigable.',
    '- Every folder that contains memory notes needs its own `README.md` catalog.',
    '- Every durable note should be discoverable through this catalog or a folder catalog.',
    '- Prefer updating existing notes over scattering small one-off notes.',
    '- Do not store secrets.',
    '',
  ].join('\n');
}

function createFolderCatalogTemplate(category: MemoryCategory): string {
  return [
    `# ${category.title}`,
    '',
    `Purpose: ${category.purpose}`,
    '',
    `When to read: ${category.readWhen}`,
    '',
    '## Notes Index',
    '',
    '- Add note links here as this folder grows.',
    '',
    '## Related Folders',
    '',
    '- `../README.md`: root memory catalog.',
    '',
    '## Maintenance Rules',
    '',
    '- Keep this catalog short enough to scan quickly.',
    '- Add notes only when they preserve durable context for future work.',
    '- Update this catalog whenever adding, renaming, or retiring notes in this folder.',
    '- Mark stale, disputed, or superseded knowledge explicitly.',
    '',
  ].join('\n');
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) {
    return value;
  }

  return bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '').trimEnd();
}

function toMemoryRelativePath(memoryRoot: string, path: string): string {
  return path.slice(memoryRoot.length).replace(/^\/+/, '') || '.';
}
