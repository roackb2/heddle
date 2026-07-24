import { readdir, readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { executeScopedEdit } from '@/core/tools/toolkits/coding-files/file-edit-core.js';
import type { ToolResult } from '@/core/types.js';
import { MemoryPathUtils } from './path-utils.js';
import type { ListMemoryNotesInput, ReadMemoryNoteInput, SearchMemoryNotesInput } from './types.js';

const DEFAULT_MAX_SEARCH_RESULTS = 100;

/**
 * Owns note-level memory reads, search, listing, and scoped note edits.
 */
export class MemoryNoteService {
  constructor(private readonly memoryRoot: string) {}

  async list(input: ListMemoryNotesInput = {}): Promise<string[]> {
    const targetPath = this.resolvePath(input.path ?? '.');
    if (!await MemoryPathUtils.pathExists(targetPath)) {
      return [];
    }

    const info = await stat(targetPath);
    if (info.isFile()) {
      return [MemoryPathUtils.toMemoryRelativePath(this.resolveRoot(), targetPath)];
    }

    const notes = await this.listMarkdownNotes(targetPath);
    return notes.map((path) => MemoryPathUtils.toMemoryRelativePath(this.resolveRoot(), path)).sort();
  }

  async read(input: ReadMemoryNoteInput): Promise<string> {
    const targetPath = this.resolvePath(input.path);
    try {
      return MemoryNoteService.pageText(await readFile(targetPath, 'utf8'), input.offset, input.maxLines);
    } catch (error) {
      if (MemoryPathUtils.isErrorWithCode(error, 'EISDIR')) {
        throw new Error(`Failed to read ${targetPath}: path is a directory, not a file. Use list_memory_notes to inspect memory directories.`, { cause: error });
      }
      throw new Error(`Failed to read ${targetPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async search(input: SearchMemoryNotesInput): Promise<string> {
    const targetPath = this.resolvePath(input.path ?? '.');
    if (!await MemoryPathUtils.pathExists(targetPath)) {
      return 'No matches found.';
    }

    return await this.searchWithCli(targetPath, input.query, MemoryNoteService.sanitizeMaxResults(input.maxResults));
  }

  async edit(raw: unknown): Promise<ToolResult> {
    return await executeScopedEdit(raw, {
      toolName: 'edit_memory_note',
      rootPath: this.resolveRoot(),
      rootLabel: 'memory root',
      subjectLabel: 'memory note',
      creationHint: 'Set createIfMissing to true if you want edit_memory_note to create it.',
    });
  }

  private resolvePath(path: string): string {
    const result = MemoryPathUtils.resolveMemoryPath(this.resolveRoot(), path);
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.path;
  }

  private async listMarkdownNotes(root: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '_maintenance') {
        continue;
      }

      const nextPath = resolve(root, entry.name);
      if (entry.isDirectory()) {
        results.push(...await this.listMarkdownNotes(nextPath));
        continue;
      }

      if (entry.isFile() && MemoryNoteService.isMarkdownPath(nextPath)) {
        results.push(nextPath);
      }
    }

    return results.sort();
  }

  private async searchWithCli(targetPath: string, query: string, maxResults: number): Promise<string> {
    const memoryRoot = this.resolveRoot();
    const relativeTarget = MemoryPathUtils.toMemoryRelativePath(memoryRoot, targetPath);
    const normalizedTarget = relativeTarget === '.' ? '.' : relativeTarget;

    const rgResult = await MemoryNoteService.runSearchCommand('rg', ['-n', '--no-heading', '--glob', '*.md', query, normalizedTarget], memoryRoot);
    if (rgResult.kind === 'ok') {
      return MemoryNoteService.trimSearchOutput(rgResult.stdout, maxResults);
    }

    if (rgResult.kind === 'nonzero_no_match') {
      return 'No matches found.';
    }

    if (rgResult.kind !== 'missing_binary') {
      throw new Error(`Failed to search memory notes in ${targetPath}: ${rgResult.error}`);
    }

    const grepResult = await MemoryNoteService.runSearchCommand('grep', ['-R', '-n', '--include=*.md', query, normalizedTarget], memoryRoot);
    if (grepResult.kind === 'ok') {
      return MemoryNoteService.trimSearchOutput(grepResult.stdout, maxResults);
    }

    if (grepResult.kind === 'nonzero_no_match') {
      return 'No matches found.';
    }

    throw new Error(`Failed to search memory notes in ${targetPath}: ${grepResult.error}`);
  }

  private resolveRoot(): string {
    return resolve(this.memoryRoot);
  }

  private static pageText(content: string, offset?: number, maxLines?: number): string {
    const lines = content.split('\n');
    const start = offset && offset > 0 ? Math.floor(offset) : 0;
    const end = maxLines && maxLines > 0 ? start + Math.floor(maxLines) : undefined;
    return start > 0 || end !== undefined ? lines.slice(start, end).join('\n') : content;
  }

  private static sanitizeMaxResults(value: number | undefined): number {
    if (!value || !Number.isFinite(value) || value <= 0) {
      return DEFAULT_MAX_SEARCH_RESULTS;
    }

    return Math.min(Math.floor(value), DEFAULT_MAX_SEARCH_RESULTS);
  }

  private static isMarkdownPath(path: string): boolean {
    return /\.md$/i.test(path);
  }

  private static trimSearchOutput(stdout: string, maxResults: number): string {
    const lines = stdout
      .split('\n')
      .map((line) => line.trimEnd().replace(/^\.\//, ''))
      .filter((line) => line.length > 0)
      .slice(0, maxResults);
    return lines.length > 0 ? lines.join('\n') : 'No matches found.';
  }

  private static async runSearchCommand(
    binary: string,
    args: string[],
    cwd: string,
  ): Promise<
    | { kind: 'ok'; stdout: string }
    | { kind: 'missing_binary'; error: string }
    | { kind: 'nonzero_no_match'; error: string }
    | { kind: 'error'; error: string }
  > {
    return await new Promise((resolvePromise) => {
      const child = spawn(binary, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if ('code' in error && error.code === 'ENOENT') {
          resolvePromise({ kind: 'missing_binary', error: `${binary} is not available in the environment.` });
          return;
        }

        resolvePromise({ kind: 'error', error: error.message });
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolvePromise({ kind: 'ok', stdout });
          return;
        }

        if (code === 1) {
          resolvePromise({ kind: 'nonzero_no_match', error: stderr.trim() || `${binary} returned exit code 1` });
          return;
        }

        resolvePromise({ kind: 'error', error: stderr.trim() || `${binary} returned exit code ${code ?? 'unknown'}` });
      });
    });
  }
}
