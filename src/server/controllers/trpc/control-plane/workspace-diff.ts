import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { ReviewDiffParser } from '@/core/review/index.js';
import type {
  WorkspaceChangedFileView,
  WorkspaceChangesView,
  WorkspaceFileDiffView,
} from '@/server/control-plane-types.js';

const MAX_PATCH_LENGTH = 120_000;

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RawStatusEntry = {
  path: string;
  oldPath?: string;
  indexStatus: string;
  workingTreeStatus: string;
};

export class ControlPlaneWorkspaceDiffController {
  static async readChanges(workspaceRoot: string): Promise<WorkspaceChangesView> {
    const git = await ControlPlaneWorkspaceDiffController.ensureGitWorkspace(workspaceRoot);
    if (!git.ok) {
      return {
        vcs: 'none',
        clean: true,
        files: [],
        error: git.error,
      };
    }

    const status = await ControlPlaneWorkspaceDiffController.runGit(workspaceRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (status.exitCode !== 0) {
      return {
        vcs: 'git',
        clean: true,
        files: [],
        error: ControlPlaneWorkspaceDiffController.normalizeError(status.stderr) ?? 'Unable to read git status.',
      };
    }

    const entries = ControlPlaneWorkspaceDiffController.parsePorcelainStatus(status.stdout);
    const stats = await ControlPlaneWorkspaceDiffController.readDiffStats(workspaceRoot);
    const files = entries.filter((entry) => !ControlPlaneWorkspaceDiffController.isHeddleStatePath(entry.path)).map((entry) => {
      const stat = stats.get(entry.path);
      return {
        path: entry.path,
        oldPath: entry.oldPath,
        status: ControlPlaneWorkspaceDiffController.statusFromPorcelain(entry),
        indexStatus: ControlPlaneWorkspaceDiffController.normalizeStatusCode(entry.indexStatus),
        workingTreeStatus: ControlPlaneWorkspaceDiffController.normalizeStatusCode(entry.workingTreeStatus),
        additions: stat?.additions,
        deletions: stat?.deletions,
        binary: stat?.binary,
      } satisfies WorkspaceChangedFileView;
    });

    return {
      vcs: 'git',
      clean: files.length === 0,
      files,
    };
  }

  static async readFileDiff(workspaceRoot: string, path: string): Promise<WorkspaceFileDiffView> {
    const git = await ControlPlaneWorkspaceDiffController.ensureGitWorkspace(workspaceRoot);
    const scopedPath = ControlPlaneWorkspaceDiffController.resolveWorkspacePath(workspaceRoot, path);
    if (!scopedPath.ok) {
      return {
        vcs: git.ok ? 'git' : 'none',
        path,
        error: scopedPath.error,
      };
    }
    if (ControlPlaneWorkspaceDiffController.isHeddleStatePath(scopedPath.path)) {
      return {
        vcs: git.ok ? 'git' : 'none',
        path: scopedPath.path,
        error: 'Heddle runtime state is not included in workspace review.',
      };
    }

    if (!git.ok) {
      return {
        vcs: 'none',
        path: scopedPath.path,
        error: git.error,
      };
    }

    const unstaged = await ControlPlaneWorkspaceDiffController.runGit(workspaceRoot, ['diff', '--patch', '--', scopedPath.path]);
    const staged = await ControlPlaneWorkspaceDiffController.runGit(workspaceRoot, ['diff', '--cached', '--patch', '--', scopedPath.path]);
    const patches = [unstaged.stdout, staged.stdout].filter((patch) => patch.trim().length > 0);

    if (patches.length === 0 && ControlPlaneWorkspaceDiffController.isReadableUntrackedFile(workspaceRoot, scopedPath.path)) {
      const absolutePath = resolve(workspaceRoot, scopedPath.path);
      const untracked = await ControlPlaneWorkspaceDiffController.runGit(workspaceRoot, ['diff', '--no-index', '--', '/dev/null', absolutePath]);
      if (untracked.stdout.trim()) {
        patches.push(ControlPlaneWorkspaceDiffController.rewriteNoIndexPatchPaths(untracked.stdout, scopedPath.path));
      }
    }

    const patch = patches.join('\n').trim();
    const truncated = patch ? ControlPlaneWorkspaceDiffController.truncatePatch(patch) : undefined;
    const parsedFiles = patch ? ReviewDiffParser.parseUnifiedDiffFiles(patch) : [];
    const parsedFile = parsedFiles.find((file) => file.path === scopedPath.path || file.oldPath === scopedPath.path);
    return {
      vcs: 'git',
      path: scopedPath.path,
      patch: truncated?.patch,
      diff: truncated?.truncated ? undefined : parsedFile,
      truncated: truncated?.truncated,
      binary: parsedFile?.binary ?? /Binary files .* differ/.test(patch),
    };
  }

  private static isHeddleStatePath(path: string): boolean {
    return path === '.heddle' || path.startsWith('.heddle/');
  }

  private static async ensureGitWorkspace(workspaceRoot: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await ControlPlaneWorkspaceDiffController.runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']);
    if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
      return {
        ok: false,
        error: 'Not a git workspace.',
      };
    }
    return { ok: true };
  }

  private static async readDiffStats(workspaceRoot: string): Promise<Map<string, { additions?: number; deletions?: number; binary?: boolean }>> {
    const stats = new Map<string, { additions?: number; deletions?: number; binary?: boolean }>();
    for (const args of [
      ['diff', '--numstat', '--'],
      ['diff', '--cached', '--numstat', '--'],
    ]) {
      const result = await ControlPlaneWorkspaceDiffController.runGit(workspaceRoot, args);
      if (result.exitCode !== 0) {
        continue;
      }
      for (const line of result.stdout.split('\n')) {
        const [additionsRaw, deletionsRaw, path] = line.split('\t');
        if (!additionsRaw || !deletionsRaw || !path) {
          continue;
        }
        const existing = stats.get(path) ?? {};
        if (additionsRaw === '-' || deletionsRaw === '-') {
          stats.set(path, { ...existing, binary: true });
          continue;
        }
        stats.set(path, {
          additions: (existing.additions ?? 0) + Number(additionsRaw),
          deletions: (existing.deletions ?? 0) + Number(deletionsRaw),
          binary: existing.binary,
        });
      }
    }
    return stats;
  }

  private static parsePorcelainStatus(stdout: string): RawStatusEntry[] {
    const parts = stdout.split('\0').filter(Boolean);
    const entries: RawStatusEntry[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const raw = parts[index] ?? '';
      if (raw.length < 4) {
        continue;
      }
      const indexStatus = raw[0] ?? ' ';
      const workingTreeStatus = raw[1] ?? ' ';
      const path = raw.slice(3);
      if (!path) {
        continue;
      }

      if ((indexStatus === 'R' || indexStatus === 'C') && parts[index + 1]) {
        entries.push({
          path,
          oldPath: parts[index + 1],
          indexStatus,
          workingTreeStatus,
        });
        index += 1;
        continue;
      }

      entries.push({
        path,
        indexStatus,
        workingTreeStatus,
      });
    }
    return entries;
  }

  private static statusFromPorcelain(entry: RawStatusEntry): WorkspaceChangedFileView['status'] {
    if (entry.indexStatus === '?' && entry.workingTreeStatus === '?') {
      return 'untracked';
    }
    if (entry.indexStatus === 'R') {
      return 'renamed';
    }
    if (entry.indexStatus === 'C') {
      return 'copied';
    }
    if (entry.indexStatus === 'D' || entry.workingTreeStatus === 'D') {
      return 'deleted';
    }
    if (entry.indexStatus === 'A' || entry.workingTreeStatus === 'A') {
      return 'added';
    }
    if (entry.indexStatus === 'M' || entry.workingTreeStatus === 'M') {
      return 'modified';
    }
    return 'unknown';
  }

  private static normalizeStatusCode(status: string): string | undefined {
    return status.trim() ? status : undefined;
  }

  private static resolveWorkspacePath(workspaceRoot: string, path: string): { ok: true; path: string } | { ok: false; error: string } {
    const absolutePath = resolve(workspaceRoot, path);
    const relativePath = relative(workspaceRoot, absolutePath);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return {
        ok: false,
        error: 'Path is outside the active workspace.',
      };
    }
    return {
      ok: true,
      path: relativePath,
    };
  }

  private static isReadableUntrackedFile(workspaceRoot: string, path: string): boolean {
    const absolutePath = resolve(workspaceRoot, path);
    if (!existsSync(absolutePath)) {
      return false;
    }
    try {
      return statSync(absolutePath).isFile();
    } catch {
      return false;
    }
  }

  private static rewriteNoIndexPatchPaths(patch: string, path: string): string {
    return patch
      .split('\n')
      .map((line) => {
        if (line.startsWith('+++ ')) {
          return `+++ b/${path}`;
        }
        return line;
      })
      .join('\n');
  }

  private static truncatePatch(patch: string): { patch: string; truncated: boolean } {
    if (patch.length <= MAX_PATCH_LENGTH) {
      return { patch, truncated: false };
    }
    return {
      patch: `${patch.slice(0, MAX_PATCH_LENGTH - 1)}…`,
      truncated: true,
    };
  }

  private static normalizeError(stderr: string): string | undefined {
    const trimmed = stderr.trim();
    return trimmed || undefined;
  }

  private static runGit(cwd: string, args: string[]): Promise<CommandResult> {
    return new Promise((resolveResult) => {
      execFile('git', args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        const code = typeof (error as { code?: unknown } | null)?.code === 'number'
          ? (error as { code: number }).code
          : error ? 1 : 0;
        resolveResult({
          exitCode: code,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      });
    });
  }
}
