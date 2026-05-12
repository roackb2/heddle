import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AwarenessLimit, AwarenessSource } from '../../../types.js';
import type { CodingWorkspaceTree, CodingWorkspaceTreeEntry } from '../types.js';
import { OMITTED_PATH_SEGMENTS } from './git.js';

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_ENTRIES = 60;

export async function collectCodingWorkspaceTree(input: {
  workspaceRoot: string;
  maxDepth?: number;
  maxEntries?: number;
}): Promise<{
  tree: CodingWorkspaceTree;
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
}> {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const sources: AwarenessSource[] = [{
    kind: 'filesystem',
    path: input.workspaceRoot,
    note: 'workspace tree',
  }];
  const limits: AwarenessLimit[] = [];

  const state = {
    visitedEntries: 0,
    omittedNoise: 0,
    omittedByDepth: 0,
    truncatedByEntryBudget: false,
  };

  const entries = await readTree({
    absoluteRoot: input.workspaceRoot,
    relativeRoot: '',
    depth: 1,
    maxDepth,
    maxEntries,
    state,
  });

  if (state.omittedNoise > 0) {
    limits.push({
      kind: 'omitted',
      subject: 'workspace tree',
      detail: `Omitted ${state.omittedNoise} runtime or dependency entries such as .git, .heddle, node_modules, dist, coverage, build, and cache folders.`,
    });
  }

  if (state.omittedByDepth > 0) {
    limits.push({
      kind: 'truncated',
      subject: 'workspace tree depth',
      detail: `Stopped descending into ${state.omittedByDepth} director${state.omittedByDepth === 1 ? 'y' : 'ies'} at depth ${maxDepth}.`,
    });
  }

  if (state.truncatedByEntryBudget) {
    limits.push({
      kind: 'truncated',
      subject: 'workspace tree entries',
      detail: `Showing at most ${maxEntries} entries across the tree; additional entries were omitted.`,
    });
  }

  return {
    tree: {
      root: input.workspaceRoot,
      maxDepth,
      maxEntries,
      entries,
    },
    sources,
    limits,
  };
}

async function readTree(args: {
  absoluteRoot: string;
  relativeRoot: string;
  depth: number;
  maxDepth: number;
  maxEntries: number;
  state: {
    visitedEntries: number;
    omittedNoise: number;
    omittedByDepth: number;
    truncatedByEntryBudget: boolean;
  };
}): Promise<CodingWorkspaceTreeEntry[]> {
  let dirents;
  try {
    dirents = await readdir(args.absoluteRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const visibleDirents = dirents
    .filter((dirent) => {
      if (OMITTED_PATH_SEGMENTS.has(dirent.name)) {
        args.state.omittedNoise += 1;
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  const entries: CodingWorkspaceTreeEntry[] = [];

  for (const dirent of visibleDirents) {
    if (args.state.visitedEntries >= args.maxEntries) {
      args.state.truncatedByEntryBudget = true;
      break;
    }

    const path = args.relativeRoot ? `${args.relativeRoot}/${dirent.name}` : dirent.name;
    args.state.visitedEntries += 1;

    if (dirent.isDirectory()) {
      const node: CodingWorkspaceTreeEntry = {
        path,
        kind: 'directory',
      };

      if (args.depth >= args.maxDepth) {
        node.truncated = true;
        args.state.omittedByDepth += 1;
      } else if (!args.state.truncatedByEntryBudget) {
        const children = await readTree({
          absoluteRoot: join(args.absoluteRoot, dirent.name),
          relativeRoot: path,
          depth: args.depth + 1,
          maxDepth: args.maxDepth,
          maxEntries: args.maxEntries,
          state: args.state,
        });
        if (children.length > 0) {
          node.children = children;
        }
        if (args.state.truncatedByEntryBudget) {
          node.truncated = true;
        }
      }

      entries.push(node);
      continue;
    }

    entries.push({
      path,
      kind: 'file',
    });
  }

  return entries;
}
