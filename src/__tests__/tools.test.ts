import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { listFilesTool } from '../tools/list-files.js';
import { readFileTool } from '../tools/read-file.js';
import { editFileTool, previewEditFileInput } from '../tools/edit-file.js';
import { reportStateTool } from '../tools/report-state.js';
import {
  classifyShellCommandPolicy,
  DEFAULT_INSPECT_RULES,
  createRunShellInspectTool,
  createRunShellMutateTool,
  DEFAULT_MUTATE_RULES,
} from '../tools/run-shell.js';
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
      error: 'Invalid input for read_file. Required field: path. Optional fields: maxLines, offset.',
    });
  });

  it('rejects ambiguous edit_file input', async () => {
    const result = await editFileTool.execute({ path: 'README.md', newText: 'x' });

    expect(result).toEqual({
      ok: false,
      error:
        'Invalid input for edit_file. Use either { "path", "oldText", "newText", "replaceAll?" } or { "path", "content", "createIfMissing?" }.',
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
    expect(readFileTool.description).toContain('0-based line offset');
    expect(editFileTool.description).toContain('Edit a file directly inside the current workspace');
    expect(editFileTool.description).toContain('Prefer this over shell commands');
    expect(editFileTool.description).toContain('exact replacement');
    expect(editFileTool.description).toContain('overwrite an existing file or create a new one explicitly');
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

describe('readFileTool', () => {
  it('supports paging into later lines with offset and maxLines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-read-offset-'));
    const filePath = join(root, 'sample.txt');
    await writeFile(filePath, ['zero', 'one', 'two', 'three', 'four'].join('\n'));
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await readFileTool.execute({
        path: 'sample.txt',
        offset: 2,
        maxLines: 2,
      });

      expect(result).toEqual({
        ok: true,
        output: 'two\nthree',
      });
    } finally {
      process.chdir(previousCwd);
    }
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

  it('searches inside an explicitly targeted excluded directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-search-state-'));
    await mkdir(join(root, '.heddle'));
    await mkdir(join(root, '.heddle', 'traces'));
    await writeFile(join(root, '.heddle', 'traces', 'trace-1.json'), '{"needle":true}\n');

    const result = await searchFilesTool.execute({ query: 'needle', path: join(root, '.heddle') });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('.heddle/traces/trace-1.json');
  });
});

describe('editFileTool', () => {
  it('creates a new file when explicitly allowed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-create-'));
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: 'notes/output.txt',
        content: 'hello\n',
        createIfMissing: true,
      });

      expect(result).toEqual({
        ok: true,
        output: {
          path: 'notes/output.txt',
          action: 'created',
          bytesWritten: Buffer.byteLength('hello\n', 'utf8'),
          diff: {
            path: 'notes/output.txt',
            action: 'created',
            diff: ['--- /dev/null', '+++ b/notes/output.txt', '@@ -1,0 +1 @@', '+hello'].join('\n'),
            truncated: false,
          },
        },
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('replaces an exact single match in an existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-replace-'));
    const filePath = join(root, 'sample.ts');
    await writeFile(filePath, 'const mode = "old";\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: 'sample.ts',
        oldText: '"old"',
        newText: '"new"',
      });

      expect(result).toEqual({
        ok: true,
        output: {
          path: 'sample.ts',
          action: 'replaced',
          matchCount: 1,
          bytesWritten: Buffer.byteLength('const mode = "new";\n', 'utf8'),
          diff: {
            path: 'sample.ts',
            action: 'replaced',
            diff: ['--- a/sample.ts', '+++ b/sample.ts', '@@ -1 +1 @@', '-const mode = "old";', '+const mode = "new";'].join('\n'),
            truncated: false,
          },
        },
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('rejects ambiguous replacements unless replaceAll is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-multi-'));
    const filePath = join(root, 'sample.ts');
    await writeFile(filePath, 'value\nvalue\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: 'sample.ts',
        oldText: 'value',
        newText: 'next',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('edit_file found 2 matches for oldText');
      expect(result.error).toContain('sample.ts');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('refuses to write outside the current workspace root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-scope-'));
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: '../outside.txt',
        content: 'nope\n',
        createIfMissing: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('edit_file only writes inside the current workspace root');
      expect(result.error).toContain('outside.txt');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('builds an approval preview for edit_file before the write happens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-preview-'));
    const filePath = join(root, 'sample.ts');
    await writeFile(filePath, 'const mode = "old";\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const preview = await previewEditFileInput({
        path: 'sample.ts',
        oldText: '"old"',
        newText: '"new"',
      });

      expect(preview).toEqual({
        path: 'sample.ts',
        action: 'replaced',
        diff: ['--- a/sample.ts', '+++ b/sample.ts', '@@ -1 +1 @@', '-const mode = "old";', '+const mode = "new";'].join('\n'),
        truncated: false,
      });
    } finally {
      process.chdir(previousCwd);
    }
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
    expect(tool.description).toContain('Use this when inspection is not enough');
    expect(tool.description).toContain('inline scripts or broader shell expressiveness');
    expect(tool.description).toContain('host-side execution rules');
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

  it('allows numbered file inspection in inspect mode', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'nl -ba README.md' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'nl -ba README.md',
      exitCode: 0,
      policy: {
        binary: 'nl',
        scope: 'inspect',
        risk: 'low',
        capability: 'file_inspection',
      },
    });
  });

  it('still rejects blocked shell operators in inspect mode', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'ls > out.txt' });

    expect(result).toEqual({
      ok: false,
      error: 'Command not allowed. Inspect mode permits read-only pipes, but redirects, command chaining, backgrounding, and subshells are blocked. If the command is still needed, retry with run_shell_mutate.',
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
        capability: 'environment_inspection',
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

  it('ignores unrelated extra input fields for inspect commands when command is present', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'pwd', maxLines: 400 });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'pwd',
      exitCode: 0,
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

  it('ignores unrelated extra input fields for mutate commands when command is present', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'tsc --version', rationale: 'verify compiler exists' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'tsc --version',
      exitCode: 0,
    });
  });

  it('does not treat > inside quoted node -e source as a shell redirect', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'node -e "const fn = () => 1; console.log(fn())"' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'node -e "const fn = () => 1; console.log(fn())"',
      exitCode: 0,
    });
  });

  it('allows pipes in mutate mode because mutate is approval-gated', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'echo ok | cat' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'echo ok | cat',
      exitCode: 0,
      policy: {
        binary: 'echo',
        scope: 'workspace',
        risk: 'unknown',
        capability: 'unknown_workspace',
        reason: 'unclassified workspace command requiring explicit approval',
      },
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
        capability: 'dependency',
        reason: 'workspace dependency install command',
      },
    });
  });

  it('allows project-local script execution through mutate policy metadata', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'yarn run --help' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'yarn run --help',
      exitCode: 0,
      policy: {
        binary: 'yarn',
        scope: 'workspace',
        risk: 'medium',
        capability: 'project_script',
        reason: 'workspace project script command',
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
        capability: 'unknown_workspace',
        reason: 'unclassified workspace command requiring explicit approval',
      },
    });
  });

  it('treats unclassified mutate commands as approval-gated unknown commands instead of hard rejecting them', () => {
    const result = classifyShellCommandPolicy('ffmpeg -i input.mp4 output.gif', {
      toolName: 'run_shell_mutate',
      rules: DEFAULT_MUTATE_RULES,
      allowUnknown: true,
    });

    expect(result).toEqual({
      binary: 'ffmpeg',
      scope: 'workspace',
      risk: 'unknown',
      capability: 'unknown_workspace',
      reason: 'unclassified workspace command requiring explicit approval',
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
          capability: 'file_operation',
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
