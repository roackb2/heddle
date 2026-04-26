import { homedir } from 'node:os';
import { access, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export type WorkspaceFileSuggestion = {
  path: string;
};

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  kind: 'directory';
  hasGit: boolean;
  hasHeddleState: boolean;
  hasPackageJson: boolean;
};

export type WorkspaceDirectoryListing = {
  path: string;
  parentPath?: string;
  entries: WorkspaceDirectoryEntry[];
};

const IGNORED_DIRS = new Set(['.git', '.heddle', 'coverage', 'dist', 'local', 'node_modules']);
const MAX_SCANNED_ENTRIES = 5000;

type WorkspaceDirent = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

export async function searchWorkspaceFiles(args: {
  workspaceRoot: string;
  query: string;
  limit?: number;
}): Promise<WorkspaceFileSuggestion[]> {
  const query = normalizeQuery(args.query);
  const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
  const candidates: WorkspaceFileSuggestion[] = [];
  let scanned = 0;

  async function visit(dir: string): Promise<void> {
    if (scanned >= MAX_SCANNED_ENTRIES) {
      return;
    }

    let entries: WorkspaceDirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scanned >= MAX_SCANNED_ENTRIES) {
        return;
      }

      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      scanned++;
      const fullPath = join(dir, entry.name);
      const relPath = toWorkspacePath(args.workspaceRoot, fullPath);
      if (!relPath || relPath.startsWith('../')) {
        continue;
      }

      if (entry.isFile()) {
        candidates.push({ path: relPath });
      }

      if (entry.isDirectory()) {
        await visit(fullPath);
      }
    }
  }

  await visit(args.workspaceRoot);
  return rankMatches(candidates.filter((candidate) => matchesQuery(candidate.path, query)), query).slice(0, limit);
}

export async function browseWorkspaceDirectories(args: {
  path?: string;
  limit?: number;
  includeHidden?: boolean;
}): Promise<WorkspaceDirectoryListing> {
  const root = resolve(args.path?.trim() || defaultBrowseRoot());
  const limit = Math.max(1, Math.min(args.limit ?? 100, 300));
  let entries: WorkspaceDirent[] = [];

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return {
      path: root,
      parentPath: parentPathFor(root),
      entries: [],
    };
  }

  const directories = entries
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
    .filter((entry) => args.includeHidden || !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, limit);
  const projected = await Promise.all(directories.map(async (entry) => {
    const path = join(root, entry.name);
    return {
      name: entry.name,
      path,
      kind: 'directory' as const,
      hasGit: await exists(join(path, '.git')),
      hasHeddleState: await exists(join(path, '.heddle')),
      hasPackageJson: await exists(join(path, 'package.json')),
    };
  }));

  return {
    path: root,
    parentPath: parentPathFor(root),
    entries: rankWorkspaceDirectories(projected),
  };
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/^@/, '').toLowerCase();
}

function matchesQuery(path: string, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalizedPath = path.toLowerCase();
  const basename = normalizedPath.split('/').at(-1) ?? normalizedPath;
  return normalizedPath.includes(query) || basename.includes(query);
}

function rankMatches(matches: WorkspaceFileSuggestion[], query: string): WorkspaceFileSuggestion[] {
  return [...matches].sort((left, right) => {
    const leftPath = left.path.toLowerCase();
    const rightPath = right.path.toLowerCase();
    const leftIndex = query ? leftPath.indexOf(query) : 0;
    const rightIndex = query ? rightPath.indexOf(query) : 0;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.path.localeCompare(right.path);
  });
}

function rankWorkspaceDirectories(entries: WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const leftScore = workspaceDirectoryScore(left);
    const rightScore = workspaceDirectoryScore(right);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.name.localeCompare(right.name);
  });
}

function workspaceDirectoryScore(entry: WorkspaceDirectoryEntry): number {
  return Number(entry.hasHeddleState) * 4 + Number(entry.hasGit) * 2 + Number(entry.hasPackageJson);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultBrowseRoot(): string {
  return resolve(process.env.HEDDLE_WORKSPACE_BROWSE_ROOT ?? homedir());
}

function parentPathFor(path: string): string | undefined {
  const parent = dirname(path);
  return parent === path ? undefined : parent;
}

function toWorkspacePath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path).split('\\').join('/');
}
