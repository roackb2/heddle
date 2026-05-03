import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');
const ENGINE_ROOT = 'core/chat/engine/';
const REMOVED_CHAT_PATH_PREFIXES = [
  'core/chat/session-submit',
  'core/chat/trace',
  'core/chat/storage',
  'core/chat/session-lease',
  'core/chat/session-turn-result',
  'core/chat/turn-persistence',
  'core/chat/conversation-turn',
  'core/chat/compaction',
  'core/chat/turn-host',
  'core/chat/turn-host-bridge',
];
const FORBIDDEN_PRODUCTION_TOKENS = [
  'submitChatSessionPrompt',
  'executeOrdinaryChatTurn',
  'clearOrdinaryChatTurnLease',
];

const PUBLIC_EXPORT_EXPECTATIONS = [
  'createConversationEngine',
  'runConversationTurn',
  'clearConversationTurnLease',
];

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

  it('keeps conversation engine modules free of host and UI dependencies', () => {
    const violations = findImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith(ENGINE_ROOT)),
      [/^(?:\.\.\/)+(?:cli|web|server)\//, /^react$/, /^ink$/, /react/, /ink/],
    );

    expect(violations).toEqual([]);
  });

  it('does not reintroduce deleted flat chat module paths in production imports', () => {
    const violations = findRemovedPathImportViolations(
      sourceFiles.filter((file) => isProductionSource(file)),
      REMOVED_CHAT_PATH_PREFIXES,
    );

    expect(violations).toEqual([]);
  });

  it('does not reintroduce obsolete ordinary-turn and session-submit names in production code', () => {
    const violations = findForbiddenTokenUsages(
      sourceFiles.filter((file) => isProductionSource(file)),
      FORBIDDEN_PRODUCTION_TOKENS,
    );

    expect(violations).toEqual([]);
  });

  it('keeps toolkit modules from importing command modules', () => {
    const violations = findImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('core/tools/toolkits/')),
      [/core\/commands\//, /\.\.\/\.\.\/commands\//, /\.\.\/commands\//],
    );

    expect(violations).toEqual([]);
  });

  it('keeps command modules from importing toolkit implementations directly', () => {
    const violations = findImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('core/commands/')),
      [/core\/tools\/toolkits\//, /\.\.\/\.\.\/tools\/toolkits\//, /\.\.\/tools\/toolkits\//],
    );

    expect(violations).toEqual([]);
  });

  it('keeps the package root exporting the alpha conversation engine entry points', () => {
    const indexSource = readFileSync(join(SOURCE_ROOT, 'index.ts'), 'utf8');
    for (const symbol of PUBLIC_EXPORT_EXPECTATIONS) {
      expect(indexSource).toContain(symbol);
    }
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
    const imports = readImports(file)
      .filter((specifier) => disallowed.some((pattern) => pattern.test(specifier)));

    return imports.map((specifier) => `${toSourcePath(file)} imports ${specifier}`);
  });
}

function findRemovedPathImportViolations(files: string[], removedPrefixes: string[]): string[] {
  return files.flatMap((file) => {
    const imports = readImports(file)
      .filter((specifier) => removedPrefixes.some((prefix) => normalizeImportSpecifier(specifier).startsWith(prefix)));

    return imports.map((specifier) => `${toSourcePath(file)} imports removed path ${specifier}`);
  });
}

function findForbiddenTokenUsages(files: string[], forbiddenTokens: string[]): string[] {
  return files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return forbiddenTokens
      .filter((token) => source.includes(token))
      .map((token) => `${toSourcePath(file)} contains forbidden token ${token}`);
  });
}

function readImports(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1]!);
}

function normalizeImportSpecifier(specifier: string): string {
  return specifier
    .replace(/^\.\//, '')
    .replace(/\.js$/, '')
    .replace(/\\/g, '/');
}

function isProductionSource(file: string): boolean {
  return !toSourcePath(file).startsWith('__tests__/');
}

function toSourcePath(file: string): string {
  return relative(SOURCE_ROOT, file).split(sep).join('/');
}
