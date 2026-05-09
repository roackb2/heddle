// ---------------------------------------------------------------------------
// Tool: search_files
// Uses mature local search tools while keeping defaults focused and bounded.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import type { ToolDefinition, ToolResult } from '../../../types.js';

type SearchFilesInput = {
  query: string;
  path?: string;
  includeIgnored?: boolean;
};

type SearchBackend = 'auto' | 'rg' | 'grep';

export const DEFAULT_SEARCH_EXCLUDED_DIRS = ['dist', 'node_modules', 'local'];
const PROTECTED_STATE_DIRS = ['.git', '.heddle'];
const SEARCH_TIMEOUT_MS = 15_000;
const SEARCH_MAX_BUFFER = 1024 * 1024;
const GREP_BATCH_SIZE = 200;
const PROJECT_IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.rgignore'];

export type SearchFilesOptions = {
  excludedDirs?: string[];
  workspaceRoot?: string;
  backend?: SearchBackend;
};

let cachedRipgrepAvailable: boolean | undefined;

export function createSearchFilesTool(options: SearchFilesOptions = {}): ToolDefinition {
  const hasCustomExcludedDirs = Array.isArray(options.excludedDirs) && options.excludedDirs.length > 0;
  const configuredExcludedDirNames = sanitizeExcludedDirs(options.excludedDirs);
  const customExcludedDirNames = getCustomExcludedDirs(configuredExcludedDirNames, hasCustomExcludedDirs);
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
      const explicitlyTargetedConfiguredDirs = configuredExcludedDirNames.filter((name) => isExplicitlyTargetingExcludedDir(dir, name));
      const explicitlyTargetedProtectedDirs = PROTECTED_STATE_DIRS.filter((name) => isExplicitlyTargetingExcludedDir(dir, name));
      const includeIgnored = input.includeIgnored === true || explicitlyTargetedConfiguredDirs.length > 0 || explicitlyTargetedProtectedDirs.length > 0;
      const protectedExcludedDirs = getProtectedExcludedDirs(dir);
      const customExcludedDirs = customExcludedDirNames.filter((name) => !isExplicitlyTargetingExcludedDir(dir, name));
      const fallbackExcludedDirs = getFallbackExcludedDirs({
        dir,
        fallbackExcludedDirs: customExcludedDirNames.length > 0 ? customExcludedDirNames : DEFAULT_SEARCH_EXCLUDED_DIRS,
      });
      const selectedBackend = selectSearchBackend(backend, dir);
      const gitRepoRoot = findGitRepoRoot(dir);
      const hasProjectIgnoreFile = findProjectIgnoreFile(dir, gitRepoRoot ?? workspaceRoot) !== undefined;
      const fallbackExcludesApply = !includeIgnored && !hasProjectIgnoreFile;

      try {
        const output = selectedBackend === 'rg'
          ? runRipgrepSearch({
              query: input.query,
              dir,
              includeIgnored,
              excludedDirs:
                includeIgnored ? protectedExcludedDirs
                : [
                    ...new Set([
                      ...protectedExcludedDirs,
                      ...customExcludedDirs,
                      ...(fallbackExcludesApply ? fallbackExcludedDirs : []),
                    ]),
                  ],
            })
          : runGrepFallbackSearch({
              query: input.query,
              dir,
              includeIgnored,
              gitRepoRoot,
              fallbackExcludesApply,
              protectedExcludedDirs,
              fallbackExcludedDirs,
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

function selectSearchBackend(preferred: SearchBackend, dir: string): 'rg' | 'grep' {
  if (preferred === 'grep') {
    return 'grep';
  }

  if (preferred === 'rg') {
    return isRipgrepAvailableForDir(dir) ? 'rg' : 'grep';
  }

  return isRipgrepAvailableForDir(dir) ? 'rg' : 'grep';
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

function isRipgrepAvailableForDir(dir: string): boolean {
  if (!isRipgrepAvailable()) {
    return false;
  }

  try {
    execFileSync('rg', ['--version'], {
      cwd: dir,
      stdio: 'ignore',
      timeout: 2_000,
      maxBuffer: SEARCH_MAX_BUFFER,
    });
    return true;
  } catch {
    return false;
  }
}

function runRipgrepSearch(args: {
  query: string;
  dir: string;
  includeIgnored: boolean;
  excludedDirs: string[];
}): string {
  const commandArgs = [
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    ...args.excludedDirs.flatMap((name) => ['--glob', `!**/${name}/**`]),
  ];

  if (args.includeIgnored) {
    commandArgs.push('--no-ignore', '--hidden');
  }

  commandArgs.push('--', args.query, '.');
  return execFileSync('rg', commandArgs, {
    cwd: args.dir,
    encoding: 'utf-8',
    timeout: SEARCH_TIMEOUT_MS,
    maxBuffer: SEARCH_MAX_BUFFER,
  });
}

function runGrepFallbackSearch(args: {
  query: string;
  dir: string;
  includeIgnored: boolean;
  gitRepoRoot: string | undefined;
  fallbackExcludesApply: boolean;
  protectedExcludedDirs: string[];
  fallbackExcludedDirs: string[];
}): string {
  if (args.includeIgnored) {
    return runBroadGrepSearch({
      query: args.query,
      dir: args.dir,
      excludedDirs: args.protectedExcludedDirs,
    });
  }

  if (args.gitRepoRoot) {
    const targetPathspec = determineGitPathspec(args.gitRepoRoot, args.dir);
    const searchableFiles = listGitSearchableFiles(args.gitRepoRoot, targetPathspec);
    const filteredFiles = filterSearchableFiles(
      searchableFiles,
      args.fallbackExcludesApply ?
        [...new Set([...args.protectedExcludedDirs, ...args.fallbackExcludedDirs])]
      : args.protectedExcludedDirs,
    );
    return runGrepOnFiles({
      query: args.query,
      cwd: args.gitRepoRoot,
      files: filteredFiles,
    });
  }

  return runBroadGrepSearch({
    query: args.query,
    dir: args.dir,
    excludedDirs: args.fallbackExcludedDirs,
  });
}

function runBroadGrepSearch(args: { query: string; dir: string; excludedDirs: string[] }): string {
  return execFileSync(
    'grep',
    [
      '-rnI',
      ...args.excludedDirs.map((name) => `--exclude-dir=${name}`),
      '--',
      args.query,
      '.',
    ],
    {
      cwd: args.dir,
      encoding: 'utf-8',
      timeout: SEARCH_TIMEOUT_MS,
      maxBuffer: SEARCH_MAX_BUFFER,
    },
  );
}

function runGrepOnFiles(args: { query: string; cwd: string; files: string[] }): string {
  if (args.files.length === 0) {
    return '';
  }

  const outputs: string[] = [];
  for (let index = 0; index < args.files.length; index += GREP_BATCH_SIZE) {
    const batch = args.files.slice(index, index + GREP_BATCH_SIZE);
    try {
      const output = execFileSync(
        'grep',
        ['-nI', '--', args.query, ...batch],
        {
          cwd: args.cwd,
          encoding: 'utf-8',
          timeout: SEARCH_TIMEOUT_MS,
          maxBuffer: SEARCH_MAX_BUFFER,
        },
      );
      if (output.trim()) {
        outputs.push(output.trim());
      }
    } catch (err) {
      if (!isSearchNoMatchError(err)) {
        throw err;
      }
    }
  }

  return outputs.join('\n');
}

function findGitRepoRoot(dir: string): string | undefined {
  try {
    const output = execFileSync(
      'git',
      ['-C', dir, 'rev-parse', '--show-toplevel'],
      {
        encoding: 'utf-8',
        timeout: 2_000,
        maxBuffer: SEARCH_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    return output ? realpathSync(output) : undefined;
  } catch {
    return undefined;
  }
}

function determineGitPathspec(repoRoot: string, dir: string): string {
  const normalizedRepoRoot = realpathSync(repoRoot);
  const normalizedDir = realpathSync(dir);
  const pathspec = relative(normalizedRepoRoot, normalizedDir).replace(/\\/g, '/');
  return pathspec && pathspec !== '' ? pathspec : '.';
}

function listGitSearchableFiles(repoRoot: string, pathspec: string): string[] {
  const output = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-files', '-co', '--exclude-standard', '--', pathspec],
    {
      encoding: 'utf-8',
      timeout: SEARCH_TIMEOUT_MS,
      maxBuffer: SEARCH_MAX_BUFFER,
    },
  );

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function filterSearchableFiles(files: string[], excludedDirNames: string[]): string[] {
  if (excludedDirNames.length === 0) {
    return files;
  }

  return files.filter((filePath) =>
    excludedDirNames.every((dirName) => !isPathInsideExcludedDir(filePath, dirName))
  );
}

function isPathInsideExcludedDir(filePath: string, excludedDirName: string): boolean {
  const normalizedExcludedName = excludedDirName.trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!normalizedExcludedName) {
    return false;
  }

  const segments = filePath.split(/[/\\]+/).filter(Boolean);
  return segments.includes(normalizedExcludedName);
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

function getCustomExcludedDirs(configuredExcludedDirs: string[], hasCustomExcludedDirs: boolean): string[] {
  if (!hasCustomExcludedDirs) {
    return [];
  }

  const nonProtectedDirs = configuredExcludedDirs.filter((name) => !PROTECTED_STATE_DIRS.includes(name));
  if (nonProtectedDirs.every((name) => DEFAULT_SEARCH_EXCLUDED_DIRS.includes(name))) {
    return [];
  }

  return nonProtectedDirs;
}

function getProtectedExcludedDirs(dir: string): string[] {
  return PROTECTED_STATE_DIRS.filter((name) => !isExplicitlyTargetingExcludedDir(dir, name));
}

function getFallbackExcludedDirs(args: {
  dir: string;
  fallbackExcludedDirs: string[];
}): string[] {
  return [
    ...new Set([
      ...getProtectedExcludedDirs(args.dir),
      ...args.fallbackExcludedDirs.filter((name) => !isExplicitlyTargetingExcludedDir(args.dir, name)),
    ]),
  ];
}

function findProjectIgnoreFile(startDir: string, stopDir: string): string | undefined {
  let currentDir = resolve(startDir);
  const normalizedStopDir = resolve(stopDir);
  const homeDir = homedir();

  while (true) {
    for (const fileName of PROJECT_IGNORE_FILE_NAMES) {
      const ignoreFilePath = resolve(currentDir, fileName);
      if (existsSync(ignoreFilePath)) {
        return ignoreFilePath;
      }
    }

    if (currentDir === normalizedStopDir || currentDir === homeDir) {
      return undefined;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function isExplicitlyTargetingExcludedDir(dir: string, excludedName: string): boolean {
  const normalizedExcludedName = excludedName.trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!normalizedExcludedName) {
    return false;
  }

  const segments = dir.split(/[/\\]+/).filter(Boolean);
  return segments.includes(normalizedExcludedName);
}
