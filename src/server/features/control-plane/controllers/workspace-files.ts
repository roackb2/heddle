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

export class ControlPlaneWorkspaceFilesController {
  static async searchFiles(args: {
    workspaceRoot: string;
    query: string;
    limit?: number;
  }): Promise<WorkspaceFileSuggestion[]> {
    const query = ControlPlaneWorkspaceFilesController.normalizeQuery(args.query);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
    const candidates: WorkspaceFileSuggestion[] = [];
    let scanned = 0;

    const visit = async (dir: string): Promise<void> => {
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
        const relPath = ControlPlaneWorkspaceFilesController.toWorkspacePath(args.workspaceRoot, fullPath);
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
    };

    await visit(args.workspaceRoot);
    return ControlPlaneWorkspaceFilesController.rankMatches(
      candidates.filter((candidate) => ControlPlaneWorkspaceFilesController.matchesQuery(candidate.path, query)),
      query,
    ).slice(0, limit);
  }

  static async browseDirectories(args: {
    path?: string;
    limit?: number;
    includeHidden?: boolean;
  }): Promise<WorkspaceDirectoryListing> {
    const root = resolve(args.path?.trim() || ControlPlaneWorkspaceFilesController.defaultBrowseRoot());
    const limit = Math.max(1, Math.min(args.limit ?? 100, 300));
    let entries: WorkspaceDirent[];

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return {
        path: root,
        parentPath: ControlPlaneWorkspaceFilesController.parentPathFor(root),
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
        hasGit: await ControlPlaneWorkspaceFilesController.exists(join(path, '.git')),
        hasHeddleState: await ControlPlaneWorkspaceFilesController.exists(join(path, '.heddle')),
        hasPackageJson: await ControlPlaneWorkspaceFilesController.exists(join(path, 'package.json')),
      };
    }));

    return {
      path: root,
      parentPath: ControlPlaneWorkspaceFilesController.parentPathFor(root),
      entries: ControlPlaneWorkspaceFilesController.rankWorkspaceDirectories(projected),
    };
  }

  private static normalizeQuery(query: string): string {
    return query.trim().replace(/^@/, '').toLowerCase();
  }

  private static matchesQuery(path: string, query: string): boolean {
    if (!query) {
      return true;
    }

    const normalizedPath = path.toLowerCase();
    const basename = normalizedPath.split('/').at(-1) ?? normalizedPath;
    return normalizedPath.includes(query) || basename.includes(query);
  }

  private static rankMatches(matches: WorkspaceFileSuggestion[], query: string): WorkspaceFileSuggestion[] {
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

  private static rankWorkspaceDirectories(entries: WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
    return [...entries].sort((left, right) => {
      const leftScore = ControlPlaneWorkspaceFilesController.workspaceDirectoryScore(left);
      const rightScore = ControlPlaneWorkspaceFilesController.workspaceDirectoryScore(right);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return left.name.localeCompare(right.name);
    });
  }

  private static workspaceDirectoryScore(entry: WorkspaceDirectoryEntry): number {
    return Number(entry.hasHeddleState) * 4 + Number(entry.hasGit) * 2 + Number(entry.hasPackageJson);
  }

  private static async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private static defaultBrowseRoot(): string {
    return resolve(process.env.HEDDLE_WORKSPACE_BROWSE_ROOT ?? homedir());
  }

  private static parentPathFor(path: string): string | undefined {
    const parent = dirname(path);
    return parent === path ? undefined : parent;
  }

  private static toWorkspacePath(workspaceRoot: string, path: string): string {
    return relative(workspaceRoot, path).split('\\').join('/');
  }
}
