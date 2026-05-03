import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');

describe('core import boundaries', () => {
  const sourceFiles = listSourceFiles(SOURCE_ROOT);

  it('keeps core modules independent from host adapters', () => {
    const violations = findImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('core/')),
      [/^(?:\.\.\/)+(?:cli|web|server)\//],
    );

    expect(violations).toEqual([]);
  });

  it('keeps core modules from importing the public package root', () => {
    const violations = findImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('core/')),
      [/^(?:\.\.\/)+index\.js$/],
    );

    expect(violations).toEqual([]);
  });

  it('keeps command modules free of React and Ink UI dependencies', () => {
    const violations = findImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('core/commands/')),
      [/^react$/, /^ink$/, /react/, /ink/],
    );

    expect(violations).toEqual([]);
  });

  it('keeps approval core free of host code', () => {
    const violations = findImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('core/approvals/')),
      [/^(?:\.\.\/)+(?:cli|web|server)\//],
    );

    expect(violations).toEqual([]);
  });
});

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listSourceFiles(path);
    }

    return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

function findImportViolations(files: string[], disallowed: RegExp[]): string[] {
  return files.flatMap((file) => {
    const imports = [...readFileSync(file, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1]!)
      .filter((specifier) => disallowed.some((pattern) => pattern.test(specifier)));

    return imports.map((specifier) => `${toSourcePath(file)} imports ${specifier}`);
  });
}

function toSourcePath(file: string): string {
  return relative(SOURCE_ROOT, file).split(sep).join('/');
}
