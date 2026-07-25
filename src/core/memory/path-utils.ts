import { access, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  WorkspacePathOutsideRootError,
  WorkspacePathPolicy,
} from '@/core/tools/toolkits/coding-files/workspace-path-policy.js';

export class MemoryPathUtils {
  /**
   * Resolves a requested memory-note path to a canonical path inside the memory
   * root.
   *
   * Containment is delegated to `WorkspacePathPolicy`, the same canonical
   * policy the coding-files toolkit and `edit_memory_note` already use, so a
   * symlink inside the memory root cannot redirect a read, search, or listing
   * outside it. This module owns only the memory-specific error vocabulary.
   */
  static async resolveMemoryPath(
    memoryRoot: string,
    requestedPath: string,
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    if (!requestedPath.trim()) {
      return { ok: false, error: `Memory note paths must be non-empty and stay inside ${memoryRoot}.` };
    }

    const canonicalRoot = await MemoryPathUtils.canonicalRootOrUndefined(resolve(memoryRoot));
    if (!canonicalRoot) {
      // The memory root does not exist yet, so there is no tree to traverse and
      // no symlink that could redirect the path. A lexical check is exact here,
      // and it still rejects paths that climb out of the root.
      return MemoryPathUtils.resolveAgainstMissingRoot(memoryRoot, requestedPath);
    }

    try {
      // resolveCreatable tolerates a missing target and anchors it at its
      // nearest existing canonical parent. Callers decide what a missing note
      // means: list and search report nothing, read surfaces the read failure.
      const resolved = await WorkspacePathPolicy.resolveCreatable({
        workspaceRoot: memoryRoot,
        path: requestedPath,
      });
      return { ok: true, path: resolved.canonicalPath };
    } catch (error) {
      if (error instanceof WorkspacePathOutsideRootError) {
        return {
          ok: false,
          error: `Memory note paths must stay inside ${memoryRoot}. Refusing to access ${error.canonicalPath}.`,
        };
      }

      throw error;
    }
  }

  /**
   * Canonical form of the memory root, or its lexical form when the root does
   * not exist yet.
   *
   * Resolved paths are canonical, so anything that relativizes against the root
   * — note listings, search targets — must use this rather than the configured
   * root. They differ whenever the root sits under a symlink, which is the
   * normal case for temporary directories on macOS.
   */
  static async canonicalRoot(memoryRoot: string): Promise<string> {
    const resolvedRoot = resolve(memoryRoot);
    return await MemoryPathUtils.canonicalRootOrUndefined(resolvedRoot) ?? resolvedRoot;
  }

  static toMemoryRelativePath(memoryRoot: string, filePath: string): string {
    return relative(memoryRoot, filePath) || '.';
  }

  static async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  static isErrorWithCode(error: unknown, code: string): error is Error & { code: string } {
    return error instanceof Error && 'code' in error && error.code === code;
  }

  private static async canonicalRootOrUndefined(memoryRoot: string): Promise<string | undefined> {
    try {
      return await realpath(resolve(memoryRoot));
    } catch (error) {
      if (MemoryPathUtils.isErrorWithCode(error, 'ENOENT') || MemoryPathUtils.isErrorWithCode(error, 'ENOTDIR')) {
        return undefined;
      }

      throw error;
    }
  }

  private static resolveAgainstMissingRoot(
    memoryRoot: string,
    requestedPath: string,
  ): { ok: true; path: string } | { ok: false; error: string } {
    const targetPath = resolve(memoryRoot, requestedPath);
    const rel = relative(resolve(memoryRoot), targetPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return {
        ok: false,
        error: `Memory note paths must stay inside ${memoryRoot}. Refusing to access ${targetPath}.`,
      };
    }

    return { ok: true, path: targetPath };
  }
}
