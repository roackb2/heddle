import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { DEFAULT_SEARCH_EXCLUDED_DIRS } from '../../../core/tools/search-files.js';

export type ResolvedFileMention = {
  token: string;
  path: string;
  index: number;
};

export function listMentionableFiles(workspaceRoot: string, excludedDirs: string[] = []): string[] {
  const effectiveExcludedDirs = sanitizeExcludedDirs(excludedDirs);
  const excludeArgs = effectiveExcludedDirs.flatMap((dir) => ['-g', `!${dir}/**`]);

  try {
    const output = execSync(['rg', '--files', '--hidden', ...excludeArgs].map(escapeShellArg).join(' '), {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getMentionQuery(draft: string): string | undefined {
  const match = draft.match(/(^|[\s(])@([^\s@]*)$/);
  if (!match) {
    return undefined;
  }

  return match[2] ?? '';
}

export function insertMentionSelection(draft: string, selectedPath: string): string {
  return draft.replace(/(^|[\s(])@([^\s@]*)$/, (_full, prefix) => `${prefix}@${selectedPath}`);
}

export function filterMentionableFiles(files: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return files.slice(0, 50);
  }

  const ranked = files
    .filter((file) => file.toLowerCase().includes(normalized))
    .sort((left, right) => compareMentionMatches(left, right, normalized));

  return ranked.slice(0, 50);
}

export function buildPromptWithFileMentions(
  prompt: string,
  workspaceRoot: string,
  knownFiles: string[],
): { runPrompt: string; mentions: ResolvedFileMention[] } {
  const mentions = resolveMentions(prompt, workspaceRoot, knownFiles);
  if (mentions.length === 0) {
    return { runPrompt: prompt, mentions };
  }

  const hostNote = [
    'Host note: the user referenced files inline with @mentions.',
    'Treat the resolved mentioned files below as mandatory first-pass context and inspect them before answering.',
    'For large files, use targeted reads or partial windows rather than reading the entire file blindly.',
    '',
    'Resolved mentioned files in order:',
    ...mentions.map((mention, index) => `${index + 1}. ${mention.token} -> ${mention.path}`),
    '',
    'Original user prompt:',
    prompt,
  ].join('\n');

  return {
    runPrompt: `${hostNote}\n`,
    mentions,
  };
}

function resolveMentions(prompt: string, workspaceRoot: string, knownFiles: string[]): ResolvedFileMention[] {
  const matches = [...prompt.matchAll(/(^|[\s(])@([^\s@]+)/g)];
  const seen = new Set<string>();
  const resolvedMentions: ResolvedFileMention[] = [];

  for (const match of matches) {
    const tokenPath = match[2];
    const prefix = match[1] ?? '';
    const index = (match.index ?? 0) + prefix.length;
    if (!tokenPath) {
      continue;
    }

    const resolvedPath = resolveMentionPath(tokenPath, workspaceRoot, knownFiles);
    if (!resolvedPath) {
      continue;
    }

    const signature = `${index}:${resolvedPath}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    resolvedMentions.push({
      token: `@${tokenPath}`,
      path: resolvedPath,
      index,
    });
  }

  return resolvedMentions;
}

function resolveMentionPath(tokenPath: string, workspaceRoot: string, knownFiles: string[]): string | undefined {
  const normalized = tokenPath.replace(/^\.?\//, '').replace(/\\/g, '/');
  if (knownFiles.includes(normalized)) {
    return normalized;
  }

  const absolutePath = resolve(workspaceRoot, tokenPath);
  if (existsSync(absolutePath)) {
    const relativePath = relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
    return relativePath && !relativePath.startsWith('..') ? relativePath : absolutePath;
  }

  return undefined;
}

function sanitizeExcludedDirs(custom: string[]): string[] {
  const candidate = custom.length > 0 ? custom : DEFAULT_SEARCH_EXCLUDED_DIRS;
  return candidate
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^\.?\//, '').replace(/\/+$/, ''));
}

function compareMentionMatches(left: string, right: string, query: string): number {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const leftBase = leftLower.split('/').pop() ?? leftLower;
  const rightBase = rightLower.split('/').pop() ?? rightLower;

  const leftExactBase = leftBase === query ? 0 : 1;
  const rightExactBase = rightBase === query ? 0 : 1;
  if (leftExactBase !== rightExactBase) {
    return leftExactBase - rightExactBase;
  }

  const leftBaseStarts = leftBase.startsWith(query) ? 0 : 1;
  const rightBaseStarts = rightBase.startsWith(query) ? 0 : 1;
  if (leftBaseStarts !== rightBaseStarts) {
    return leftBaseStarts - rightBaseStarts;
  }

  const leftPathStarts = leftLower.startsWith(query) ? 0 : 1;
  const rightPathStarts = rightLower.startsWith(query) ? 0 : 1;
  if (leftPathStarts !== rightPathStarts) {
    return leftPathStarts - rightPathStarts;
  }

  return left.length - right.length || left.localeCompare(right);
}

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
