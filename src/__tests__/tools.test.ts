import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { listFilesTool } from '../tools/list-files.js';
import { readFileTool } from '../tools/read-file.js';
import { reportStateTool } from '../tools/report-state.js';
import { createRunShellInspectTool, createRunShellMutateTool } from '../tools/run-shell.js';
import { createSearchFilesTool, searchFilesTool } from '../tools/search-files.js';

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
    expect(listFilesTool.description).toContain('explore an obvious nearby folder');
    expect(listFilesTool.description).toContain('may also point to nearby parent or sibling folders');
    expect(listFilesTool.description).toContain('newline-separated list of entry names');
    expect(readFileTool.description).toContain('not when you want to inspect a directory');
    expect(readFileTool.description).toContain('may also point to nearby parent or sibling folders');
    expect(readFileTool.description).toContain('Returns the file text directly');
    expect(listFilesTool.description).toContain('{ "path": "." }');
    expect(listFilesTool.description).toContain('{ "path": ".." }');
    expect(readFileTool.description).toContain('{ "path": "path/to/file.txt" }');
    expect(readFileTool.description).toContain('{ "path": "../shared-notes/summary.md" }');
    expect(searchFilesTool.description).toContain('locate a specific symbol or text string');
    expect(searchFilesTool.description).toContain('Prefer searching for concrete terms');
    expect(searchFilesTool.description).toContain('may also point to nearby parent or sibling folders');
    expect(searchFilesTool.description).toContain('grep-style path:line:content format');
    expect(searchFilesTool.description).toContain('{ "query": "createUser" }');
    expect(searchFilesTool.description).toContain('{ "query": "incident", "path": "../shared-notes" }');
    expect(reportStateTool.description).toContain('Use this when you are blocked, uncertain');
    expect(reportStateTool.description).toContain('tell the library author what capability, input, or support was missing');
    expect(reportStateTool.description).toContain('Returns the same structured report back');
    expect(reportStateTool.description).toContain('"nextNeed": "list_files on ."');
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

  it('supports project-specific excluded directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-search-config-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'vendor'));
    await writeFile(join(root, 'src', 'main.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'vendor', 'hidden.ts'), 'const needle = true;\n');

    const tool = createSearchFilesTool({ excludedDirs: ['vendor'] });
    const result = await tool.execute({ query: 'needle', path: root });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('src/main.ts');
    expect(result.output).not.toContain('vendor/hidden.ts');
  });
});

describe('runShell tools', () => {
  it('documents inspect-oriented shell usage and safe prefixes', () => {
    const tool = createRunShellInspectTool();

    expect(tool.name).toBe('run_shell_inspect');
    expect(tool.description).toContain('Use this for CLI-native inspection, search, diff, and git state checks');
    expect(tool.description).toContain('policy metadata');
    expect(tool.description).toContain('low-risk inspect rules');
  });

  it('documents mutate-oriented shell usage and bounded workspace actions', () => {
    const tool = createRunShellMutateTool();

    expect(tool.name).toBe('run_shell_mutate');
    expect(tool.requiresApproval).toBe(true);
    expect(tool.description).toContain('Use this only when inspection is not enough');
    expect(tool.description).toContain('verification, formatting, staging');
    expect(tool.description).toContain('workspace execution rules');
  });

  it('allows read-only pipes in inspect mode', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'cat README.md | head -n 1' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'cat README.md | head -n 1',
      exitCode: 0,
      policy: {
        binary: 'cat',
        scope: 'inspect',
        risk: 'low',
      },
    });
  });

  it('still rejects blocked shell operators in inspect mode', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'ls > out.txt' });

    expect(result).toEqual({
      ok: false,
      error: 'Command not allowed. Inspect mode permits read-only pipes, but redirects, command chaining, backgrounding, and subshells are blocked.',
    });
  });

  it('returns structured stdout and exit code for successful inspect commands', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'pwd' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'pwd',
      exitCode: 0,
      stderr: '',
      policy: {
        binary: 'pwd',
        scope: 'inspect',
        risk: 'low',
      },
    });
    expect(typeof (result.output as { stdout: unknown }).stdout).toBe('string');
  });

  it('returns structured failure details for allowed inspect commands that exit non-zero', async () => {
    const tool = createRunShellInspectTool();
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

  it('rejects invalid inspect input using the new tool name', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ path: '.' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for run_shell_inspect. Required field: command.',
    });
  });

  it('allows bounded mutate commands with structured output', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'tsc --version' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'tsc --version',
      exitCode: 0,
      stderr: '',
    });
  });

  it('rejects pipes in mutate mode', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'yarn test | cat' });

    expect(result).toEqual({
      ok: false,
      error: 'Command not allowed. Shell control operators such as pipes, redirects, command chaining, or subshells are blocked.',
    });
  });

  it('allows approved dependency install commands through mutate policy', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'yarn add --help' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'yarn add --help',
      exitCode: 0,
      policy: {
        binary: 'yarn',
        scope: 'workspace',
        risk: 'medium',
        reason: 'workspace dependency install command',
      },
    });
  });

  it('treats unclassified mutate commands as approval-gated unknown workspace commands instead of hard rejecting them', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'pwd' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'pwd',
      exitCode: 0,
      policy: {
        binary: 'pwd',
        scope: 'workspace',
        risk: 'unknown',
        reason: 'unclassified workspace command requiring explicit approval',
      },
    });
  });

  it('allows bounded workspace file operations on mutate with policy metadata', async () => {
    const tool = createRunShellMutateTool();
    const root = await mkdtemp(join(tmpdir(), 'heddle-shell-'));
    const fromPath = join(root, 'from.txt');
    const toPath = join(root, 'to.txt');
    await writeFile(fromPath, 'hello\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await tool.execute({ command: 'mv from.txt to.txt' });

      expect(result.ok).toBe(true);
      expect(result.output).toMatchObject({
        command: 'mv from.txt to.txt',
        exitCode: 0,
        policy: {
          binary: 'mv',
          scope: 'workspace',
          risk: 'medium',
        },
      });
    } finally {
      process.chdir(previousCwd);
    }

    expect(toPath).not.toBe(fromPath);
  });
});

describe('reportStateTool', () => {
  it('accepts structured missing-gap reports and echoes them back', async () => {
    const result = await reportStateTool.execute({
      rationale: 'I need to inspect the top-level directory first.',
      missing: ['Top-level directory contents'],
      nextNeed: 'list_files on .',
    });

    expect(result).toEqual({
      ok: true,
      output: {
        rationale: 'I need to inspect the top-level directory first.',
        missing: ['Top-level directory contents'],
        nextNeed: 'list_files on .',
      },
    });
  });

  it('rejects invalid report_state input', async () => {
    const result = await reportStateTool.execute({
      missing: ['Need more context'],
    });

    expect(result).toEqual({
      ok: false,
      error:
        'Invalid input for report_state. Required field: rationale. Optional fields: missing, nextNeed.',
    });
  });
});
