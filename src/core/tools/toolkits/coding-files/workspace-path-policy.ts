import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type CanonicalWorkspacePath = {
  requestedPath: string;
  canonicalPath: string;
  canonicalRoot: string;
  exists: boolean;
};

export type CanonicalToolTarget = CanonicalWorkspacePath & {
  role: CanonicalToolTargetRole;
};

export type CanonicalToolTargetRole = 'target' | 'source' | 'destination';

export class WorkspacePathOutsideRootError extends Error {
  readonly code = 'WORKSPACE_PATH_OUTSIDE_ROOT';

  constructor(
    readonly requestedPath: string,
    readonly canonicalPath: string,
    readonly canonicalRoot: string,
    readonly exists: boolean,
    readonly role: CanonicalToolTargetRole = 'target',
  ) {
    super(
      `Workspace path resolves outside the canonical workspace root ${canonicalRoot}: `
      + `${requestedPath} -> ${canonicalPath}`,
    );
    this.name = 'WorkspacePathOutsideRootError';
  }
}

/**
 * Owns canonical workspace containment for coding-file operations.
 *
 * Existing paths are resolved through every symlink before containment is
 * checked. New paths are anchored at their nearest existing canonical parent,
 * so a symlinked parent cannot redirect creation outside the workspace.
 */
export class WorkspacePathPolicy {
  static async resolveExisting(args: {
    workspaceRoot: string;
    path: string;
  }): Promise<CanonicalWorkspacePath> {
    const requestedPath = resolve(args.workspaceRoot, args.path);
    const canonicalRoot = await realpath(resolve(args.workspaceRoot));
    const canonicalPath = await realpath(requestedPath);
    WorkspacePathPolicy.assertContained({
      requestedPath,
      canonicalPath,
      canonicalRoot,
      exists: true,
    });

    return {
      requestedPath,
      canonicalPath,
      canonicalRoot,
      exists: true,
    };
  }

  static async resolveCreatable(args: {
    workspaceRoot: string;
    path: string;
  }): Promise<CanonicalWorkspacePath> {
    const requestedPath = resolve(args.workspaceRoot, args.path);
    const canonicalRoot = await realpath(resolve(args.workspaceRoot));
    const resolvedTarget = await WorkspacePathPolicy.resolveFromNearestExistingPath(requestedPath);
    WorkspacePathPolicy.assertContained({
      requestedPath,
      canonicalPath: resolvedTarget.canonicalPath,
      canonicalRoot,
      exists: resolvedTarget.exists,
    });

    return {
      requestedPath,
      canonicalPath: resolvedTarget.canonicalPath,
      canonicalRoot,
      exists: resolvedTarget.exists,
    };
  }

  static async resolveToolTargets(args: {
    tool: string;
    input: unknown;
    workspaceRoot: string;
  }): Promise<CanonicalToolTarget[]> {
    if (!isRecord(args.input)) {
      return [];
    }

    const path = typeof args.input.path === 'string' ? args.input.path : undefined;
    if (args.tool === 'read_file' || args.tool === 'delete_file') {
      return path
        ? [await WorkspacePathPolicy.resolveToolTarget(
          'target',
          WorkspacePathPolicy.resolveExisting({ workspaceRoot: args.workspaceRoot, path }),
        )]
        : [];
    }

    if (args.tool === 'list_files' || args.tool === 'search_files') {
      return [await WorkspacePathPolicy.resolveToolTarget(
        'target',
        WorkspacePathPolicy.resolveExisting({
          workspaceRoot: args.workspaceRoot,
          path: path ?? '.',
        }),
      )];
    }

    if (args.tool === 'edit_file') {
      if (!path) {
        return [];
      }

      const isFullContentWrite = typeof args.input.content === 'string';
      const target = isFullContentWrite
        ? WorkspacePathPolicy.resolveCreatable({ workspaceRoot: args.workspaceRoot, path })
        : WorkspacePathPolicy.resolveExisting({ workspaceRoot: args.workspaceRoot, path });
      return [await WorkspacePathPolicy.resolveToolTarget('target', target)];
    }

    if (args.tool !== 'move_file') {
      return [];
    }

    const from = typeof args.input.from === 'string' ? args.input.from : undefined;
    const to = typeof args.input.to === 'string' ? args.input.to : undefined;
    if (!from || !to) {
      return [];
    }

    return [
      await WorkspacePathPolicy.resolveToolTarget(
        'source',
        WorkspacePathPolicy.resolveExisting({
          workspaceRoot: args.workspaceRoot,
          path: from,
        }),
      ),
      await WorkspacePathPolicy.resolveToolTarget(
        'destination',
        WorkspacePathPolicy.resolveCreatable({
          workspaceRoot: args.workspaceRoot,
          path: to,
        }),
      ),
    ];
  }

  private static async resolveFromNearestExistingPath(path: string): Promise<{
    canonicalPath: string;
    exists: boolean;
  }> {
    const missingSegments: string[] = [];
    let candidate = path;

    while (true) {
      try {
        await lstat(candidate);
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }

        const parent = dirname(candidate);
        if (parent === candidate) {
          throw error;
        }

        missingSegments.push(relative(parent, candidate));
        candidate = parent;
        continue;
      }

      // Keep realpath failures separate from "not found". A broken symlink is
      // an existing filesystem entry and must not be treated as a creatable
      // directory whose destination can be reconstructed lexically.
      const canonicalParent = await realpath(candidate);
      return {
        canonicalPath: resolve(canonicalParent, ...missingSegments.reverse()),
        exists: missingSegments.length === 0,
      };
    }
  }

  private static async resolveToolTarget(
    role: CanonicalToolTargetRole,
    target: Promise<CanonicalWorkspacePath>,
  ): Promise<CanonicalToolTarget> {
    try {
      return { ...await target, role };
    } catch (error) {
      if (error instanceof WorkspacePathOutsideRootError) {
        throw new WorkspacePathOutsideRootError(
          error.requestedPath,
          error.canonicalPath,
          error.canonicalRoot,
          error.exists,
          role,
        );
      }

      throw error;
    }
  }

  private static assertContained(args: {
    requestedPath: string;
    canonicalPath: string;
    canonicalRoot: string;
    exists: boolean;
  }): void {
    const relativeTarget = relative(args.canonicalRoot, args.canonicalPath);
    const outsideRoot = relativeTarget === '..'
      || relativeTarget.startsWith(`..${sep}`)
      || isAbsolute(relativeTarget);
    if (outsideRoot) {
      throw new WorkspacePathOutsideRootError(
        args.requestedPath,
        args.canonicalPath,
        args.canonicalRoot,
        args.exists,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}
