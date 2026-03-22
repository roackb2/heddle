import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { listFilesTool } from '../tools/list-files.js';
import { readFileTool } from '../tools/read-file.js';
import { createRunShellTool } from '../tools/run-shell.js';
import { searchFilesTool } from '../tools/search-files.js';

describe('tool input validation', () => {
  it('rejects unexpected fields for list_files', async () => {
    const result = await listFilesTool.execute({ path: '.', maxLines: 20 });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for list_files. Allowed fields: path. Example: { "path": "." }',
    });
  });

  it('rejects unexpected fields for read_file', async () => {
    const result = await readFileTool.execute({ path: 'README.md', query: 'tool' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for read_file. Required field: path. Optional field: maxLines.',
    });
  });

  it('tool descriptions distinguish directories from files', () => {
    expect(listFilesTool.description).toContain('Use this to inspect folders, not to read file contents');
    expect(listFilesTool.description).toContain('explore an obvious folder such as src/, src/tools/, or docs/');
    expect(listFilesTool.description).toContain('newline-separated list of entry names');
    expect(readFileTool.description).toContain('not when you want to inspect a directory');
    expect(readFileTool.description).toContain('Returns the file text directly');
    expect(listFilesTool.description).toContain('{ "path": "." }');
    expect(readFileTool.description).toContain('{ "path": "README.md" }');
    expect(searchFilesTool.description).toContain('locate a specific symbol or text string');
    expect(searchFilesTool.description).toContain('grep-style path:line:content format');
    expect(searchFilesTool.description).toContain('{ "query": "runAgent" }');
  });
});

describe('tool path mismatch guidance', () => {
  it('tells the caller to use read_file when list_files receives a file path', async () => {
    const result = await listFilesTool.execute({ path: 'README.md' });

    expect(result).toEqual({
      ok: false,
      error: `Failed to list ${join(process.cwd(), 'README.md')}: path is a file, not a directory. Use read_file for file contents.`,
    });
  });

  it('tells the caller to use list_files when read_file receives a directory path', async () => {
    const result = await readFileTool.execute({ path: 'src' });

    expect(result).toEqual({
      ok: false,
      error: `Failed to read ${join(process.cwd(), 'src')}: path is a directory, not a file. Use list_files to inspect directories.`,
    });
  });
});

describe('searchFilesTool', () => {
  it('ignores generated directories like dist and node_modules by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-search-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'dist'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'src', 'main.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'dist', 'generated.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'node_modules', 'pkg.ts'), 'const needle = true;\n');

    const result = await searchFilesTool.execute({ query: 'needle', path: root });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('src/main.ts');
    expect(result.output).not.toContain('dist/generated.ts');
    expect(result.output).not.toContain('node_modules/pkg.ts');
  });
});

describe('runShellTool', () => {
  it('documents repo-oriented shell usage and expanded safe prefixes', () => {
    const tool = createRunShellTool();

    expect(tool.description).toContain('Prefer this when mature CLI tools like rg, git, sed, or ls are a better fit');
    expect(tool.description).toContain('Returns structured output with command, exitCode, stdout, and stderr');
    expect(tool.description).toContain('git rev-parse');
    expect(tool.description).toContain('git ls-files');
    expect(tool.description).toContain('rg');
  });

  it('rejects shell control operators even when the prefix is allowed', async () => {
    const tool = createRunShellTool();
    const result = await tool.execute({ command: 'ls | wc -l' });

    expect(result).toEqual({
      ok: false,
      error: 'Command not allowed. Shell control operators such as pipes, redirects, command chaining, or subshells are blocked.',
    });
  });

  it('returns structured stdout and exit code for successful commands', async () => {
    const tool = createRunShellTool();
    const result = await tool.execute({ command: 'pwd' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'pwd',
      exitCode: 0,
      stderr: '',
    });
    expect(typeof (result.output as { stdout: unknown }).stdout).toBe('string');
  });

  it('returns structured failure details for allowed commands that exit non-zero', async () => {
    const tool = createRunShellTool();
    const result = await tool.execute({ command: 'grep definitely-not-present README.md' });

    expect(result).toMatchObject({
      ok: false,
      error: 'Shell command failed with exit code 1',
      output: {
        command: 'grep definitely-not-present README.md',
        exitCode: 1,
      },
    });
  });
});
