import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { listFilesTool } from '../tools/list-files.js';
import { readFileTool } from '../tools/read-file.js';
import { searchFilesTool } from '../tools/search-files.js';

describe('tool input validation', () => {
  it('rejects unexpected fields for list_files', async () => {
    const result = await listFilesTool.execute({ path: '.', maxLines: 20 });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for list_files. Allowed fields: path.',
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
    expect(readFileTool.description).toContain('not when you want to inspect a directory');
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
