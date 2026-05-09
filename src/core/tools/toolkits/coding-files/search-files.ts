// ---------------------------------------------------------------------------
// Tool: search_files
// Uses mature local search tools while keeping defaults focused and bounded.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../../types.js';

type SearchFilesInput = {
  query: string;
  path?: string;
  includeIgnored?: boolean;
};

type SearchBackend = 'auto' | 'rg' | 'grep';

type IgnoreContext = {
  root: string;
  ignoreFilePaths: string[];
};

export const DEFAULT_SEARCH_EXCLUDED_DIRS = ['dist', 'node_modules', 'local'];
const PROTECTED_STATE_DIRS = ['.git', '.heddle'];
const IGNORE_FILE_NAMES = ['.rgignore', '.ignore', '.gitignore'];
const GREP_TEXT_FILE_GLOBS = ['*.ts', '*.js', '*.json', '*.md', '*.txt', '*.yaml', '*.yml'];
const SEARCH_TIMEOUT_MS = 15_000;
const SEARCH_MAX_BUFFER = 1024 * 1024;

export type SearchFilesOptions = {
  excludedDirs?: string[];
  workspaceRoot?: string;
  backend?: SearchBackend;
};

let cachedRipgrepAvailable: boolean | undefined;

export function createSearchFilesTool(options: SearchFilesOptions = {}): ToolDefinition {
  const hasCustomExcludedDirs = Array.isArray(options.excludedDirs) && options.excludedDirs.length > 0;
  const configuredExcludedDirNames = sanitizeExcludedDirs(options.excludedDirs);
  const configuredWorkspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : undefined;
  const backend = options.backend ?? 'auto';

  return {
    name: 'search_files',
    description:
      'Search for a text pattern in files. Prefer rg when available for fast ignored-aware search, with a grep fallback. Use this when you need to locate a specific symbol or text string, not when a likely folder or file is already obvious from the workspace structure. Prefer searching for concrete terms such as tool names, symbols, or filenames rather than copying broad question text. Relative paths are resolved from the active workspace root and may also point to nearby parent or sibling folders. Returns newline-separated matches in grep-style path:line:content format, or "No matches found.". By default, search honors project ignore files such as .gitignore when rg is available; when no ignore file is present, fallback excludes avoid expensive/generated folders like dist, node_modules, and local. .git and .heddle stay protected from accidental broad searches unless explicitly targeted. Set includeIgnored: true only when intentionally searching ignored/dependency content such as node_modules. Example inputs: { "query": "createUser" }, { "query": "incident", "path": "../shared-notes" }, { "query": "packageName", "path": "node_modules", "includeIgnored": true }',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'The text pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Directory to search in. Defaults to "."',
        },
        includeIgnored: {
          type: 'boolean',
          description: 'Whether to include ignored/dependency content such as node_modules. Defaults to false.',
        },
      },
      required: ['query'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isSearchFilesInput(raw)) {
        return {
          ok: false,
          error: 'Invalid input for search_files. Required field: query. Optional fields: path, includeIgnored.',
        };
      }

      const input: SearchFilesInput = raw;
      const workspaceRoot = configuredWorkspaceRoot ?? process.cwd();
      const dir = resolve(workspaceRoot, input.path ?? '.');
      const nearestIgnoreContext = findNearestIgnoreContext(dir);
      const searchRoot = determineSearchRoot(dir, nearestIgnoreContext);
      const searchTarget = determineSearchTarget(dir, searchRoot);
      const ignoreFilesPresent = Boolean(nearestIgnoreContext);
      const explicitlyTargetedConfiguredDirs = configuredExcludedDirNames.filter((name) => isExplicitlyTargetingExcludedDir(dir, name));
      const explicitlyTargetedProtectedDirs = PROTECTED_STATE_DIRS.filter((name) => isExplicitlyTargetingExcludedDir(dir, name));
      const includeIgnored = input.includeIgnored === true || explicitlyTargetedConfiguredDirs.length > 0 || explicitlyTargetedProtectedDirs.length > 0;
      const excludedDirs = getEffectiveExcludedDirs({
        configuredExcludedDirs: configuredExcludedDirNames,
        hasCustomExcludedDirs,
        ignoreFilesPresent,
        dir,
        includeIgnored,
      });
      const selectedBackend = selectSearchBackend(backend);

      try {
        const output = selectedBackend === 'rg'
          ? runRipgrepSearch({
              query: input.query,
              searchRoot,
              searchTarget,
              includeIgnored,
              excludedDirs,
              ignoreFilePaths: includeIgnored ? [] : nearestIgnoreContext?.ignoreFilePaths ?? [],
            })
          : runGrepFallbackSearch({
              query: input.query,
              searchRoot,
              searchTarget,
              excludedDirs,
              ignoredDirNames: includeIgnored ? [] : parseSimpleIgnoredDirNames(nearestIgnoreContext?.ignoreFilePaths ?? []),
            });
        return { ok: true, output: output.trim() || 'No matches found.' };
      } catch (err) {
        if (isSearchNoMatchError(err)) {
          return { ok: true, output: 'No matches found.' };
        }
        return { ok: false, error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

export const searchFilesTool: ToolDefinition = createSearchFilesTool();

function isSearchFilesInput(raw: unknown): raw is SearchFilesInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'query' && key !== 'path' && key !== 'includeIgnored')) {
    return false;
  }

  if (typeof input.query !== 'string') {
    return false;
  }

  const validPath = input.path === undefined || typeof input.path === 'string';
  const validIncludeIgnored = input.includeIgnored === undefined || typeof input.includeIgnored === 'boolean';
  return validPath && validIncludeIgnored;
}

function selectSearchBackend(preferred: SearchBackend): 'rg' | 'grep' {
  if (preferred === 'grep') {
    return 'grep';
  }

  if (preferred === 'rg' || isRipgrepAvailable()) {
    return isRipgrepAvailable() ? 'rg' : 'grep';
  }

  return 'grep';
}

function isRipgrepAvailable(): boolean {
  if (cachedRipgrepAvailable !== undefined) {
    return cachedRipgrepAvailable;
  }

  try {
    execFileSync('rg', ['--version'], { stdio: 'ignore', timeout: 2_000 });
    cachedRipgrepAvailable = true;
  } catch {
    cachedRipgrepAvailable = false;
  }

  return cachedRipgrepAvailable;
}

function runRipgrepSearch(args: {
  query: string;
  searchRoot: string;
  searchTarget: string;
  includeIgnored: boolean;
  excludedDirs: string[];
  ignoreFilePaths: string[];
}): string {
  const commandArgs = [
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    ...args.excludedDirs.flatMap((name) => ['--glob', `!**/${name}/**`]),
    ...args.ignoreFilePaths.flatMap((ignorePath) => ['--ignore-file', ignorePath]),
  ];

  if (args.includeIgnored) {
    commandArgs.push('--no-ignore', '--hidden');
  }

  commandArgs.push('--', args.query, args.searchTarget);
  return execFileSync('rg', commandArgs, {
    cwd: args.searchRoot,
    encoding: 'utf-8',
    timeout: SEARCH_TIMEOUT_MS,
    maxBuffer: SEARCH_MAX_BUFFER,
  });
}

function runGrepFallbackSearch(args: {
  query: string;
  searchRoot: string;
  searchTarget: string;
  excludedDirs: string[];
  ignoredDirNames: string[];
}): string {
  const effectiveExcludedDirs = [...new Set([...args.excludedDirs, ...args.ignoredDirNames])];

  return execFileSync(
    'grep',
    [
      '-rnI',
      ...effectiveExcludedDirs.map((name) => `--exclude-dir=${name}`),
      ...GREP_TEXT_FILE_GLOBS.map((glob) => `--include=${glob}`),
      '--',
      args.query,
      args.searchTarget,
    ],
    {
      cwd: args.searchRoot,
      encoding: 'utf-8',
      timeout: SEARCH_TIMEOUT_MS,
      maxBuffer: SEARCH_MAX_BUFFER,
    },
  );
}

function isSearchNoMatchError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'status' in err && err.status === 1);
}

function sanitizeExcludedDirs(custom: string[] | undefined): string[] {
  if (!custom || custom.length === 0) {
    return DEFAULT_SEARCH_EXCLUDED_DIRS;
  }

  const normalized = custom
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^\.?\//, '').replace(/\/+$/, ''));

  return normalized.length > 0 ? normalized : DEFAULT_SEARCH_EXCLUDED_DIRS;
}

function getEffectiveExcludedDirs(args: {
  configuredExcludedDirs: string[];
  hasCustomExcludedDirs: boolean;
  ignoreFilesPresent: boolean;
  dir: string;
  includeIgnored: boolean;
}): string[] {
  const protectedDirs = PROTECTED_STATE_DIRS.filter((name) => !isExplicitlyTargetingExcludedDir(args.dir, name));

  if (args.includeIgnored) {
    return protectedDirs;
  }

  const shouldUseConfiguredExcludedDirs = args.hasCustomExcludedDirs || !args.ignoreFilesPresent;
  if (!shouldUseConfiguredExcludedDirs) {
    return protectedDirs;
  }

  const configuredDirs = args.configuredExcludedDirs.filter((name) => !isExplicitlyTargetingExcludedDir(args.dir, name));
  return [...new Set([...protectedDirs, ...configuredDirs])];
}

function findNearestIgnoreContext(startDir: string): IgnoreContext | undefined {
  let currentDir = resolve(startDir);

  while (true) {
    const ignoreFilePaths = IGNORE_FILE_NAMES
      .map((fileName) => resolve(currentDir, fileName))
      .filter((filePath) => existsSync(filePath));
    if (ignoreFilePaths.length > 0) {
      return { root: currentDir, ignoreFilePaths };
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

function determineSearchRoot(dir: string, ignoreContext: IgnoreContext | undefined): string {
  return ignoreContext?.root ?? dir;
}

function determineSearchTarget(dir: string, searchRoot: string): string {
  if (searchRoot === dir) {
    return '.';
  }

  const normalizedRoot = searchRoot.replace(/[/\\]+$/, '');
  const normalizedDir = dir.replace(/[/\\]+$/, '');
  if (normalizedDir.startsWith(`${normalizedRoot}/`) || normalizedDir.startsWith(`${normalizedRoot}\\`)) {
    return normalizedDir.slice(normalizedRoot.length + 1);
  }

  return dir;
}

function parseSimpleIgnoredDirNames(ignoreFilePaths: string[]): string[] {
  const names = new Set<string>();

  for (const ignoreFilePath of ignoreFilePaths) {
    const fileText = readIgnoreFile(ignoreFilePath);
    if (!fileText) {
      continue;
    }

    for (const rawLine of fileText.split(/\r?\n/)) {
      const parsed = parseSimpleIgnoredDirName(rawLine);
      if (parsed) {
        names.add(parsed);
      }
    }
  }

  return [...names];
}

function readIgnoreFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function parseSimpleIgnoredDirName(rawLine: string): string | undefined {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
    return undefined;
  }

  const withoutLeadingSlash = trimmed.replace(/^\//, '');
  const normalized = withoutLeadingSlash.endsWith('/')
    ? withoutLeadingSlash.slice(0, -1)
    : withoutLeadingSlash;

  if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
    return undefined;
  }

  if (/[*?[\]{}]/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function isExplicitlyTargetingExcludedDir(dir: string, excludedName: string): boolean {
  const normalizedExcludedName = excludedName.trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!normalizedExcludedName) {
    return false;
  }

  const segments = dir.split(/[/\\]+/).filter(Boolean);
  return segments.includes(normalizedExcludedName);
}
