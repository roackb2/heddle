import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');
const SCRIPT_ROOT = join(process.cwd(), 'scripts');
const TEST_ROOT = join(process.cwd(), 'src', '__tests__');
const ROOT_CONFIG_FILES = [
  join(process.cwd(), 'playwright.config.ts'),
];
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
  'ConversationAgentService',
  'ConversationPersistenceService',
  'createConversationEngine',
  'defineHostExtension',
  'EngineConversationTurnService',
  'OpenAiDeviceCodeAuthService',
];

describe('core import boundaries', () => {
  const sourceFiles = listSourceFiles(SOURCE_ROOT);
  const scriptFiles = listSourceFiles(SCRIPT_ROOT);
  const testFiles = listSourceFiles(TEST_ROOT);

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

  it('keeps core domains independent from SDK application hosts', () => {
    const violations = findResolvedImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('core/')),
      (resolvedPath) => resolvedPath.startsWith('sdk/'),
    );

    expect(violations).toEqual([]);
  });

  it('keeps SDK conversation hosts independent from Heddle product interfaces', () => {
    const productInterfaceRoots = ['cli-v2/', 'client-shared/', 'server/', 'web-v2/'];
    const violations = findResolvedImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('sdk/conversation/')),
      (resolvedPath) => productInterfaceRoots.some((root) => resolvedPath.startsWith(root)),
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

  it('keeps cli-v2 independent from the old TUI implementation', () => {
    const violations = findResolvedImportViolations(
      sourceFiles.filter((file) => toSourcePath(file).startsWith('cli-v2/')),
      (resolvedPath) => resolvedPath.startsWith('cli/chat/'),
    );

    expect(violations).toEqual([]);
  });

  it('does not reintroduce retired cli/chat imports in sources, scripts, or tests', () => {
    const violations = findResolvedImportViolations(
      [...new Set([...sourceFiles, ...scriptFiles, ...testFiles])],
      (resolvedPath) => resolvedPath.startsWith('cli/chat/'),
    );

    expect(violations).toEqual([]);
  });

  it('does not reintroduce the retired web-v1 source tree or launch scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const scriptViolations = Object.entries(scripts)
      .filter(([name, command]) => name.includes(':v1') || command.includes('src/web/') || command.includes('dist/src/web ') || command.includes('web-v1'))
      .map(([name, command]) => `${name}: ${command}`);
    const activeFileViolations = [...new Set([...sourceFiles, ...scriptFiles, ...testFiles, ...ROOT_CONFIG_FILES])]
      .flatMap((file) => {
        const normalized = relative(process.cwd(), file).split(sep).join('/');
        if (normalized === 'src/__tests__/unit/core/import-boundaries.test.ts') {
          return [];
        }
        const source = readFileSync(file, 'utf8');
        return source.includes('src/web/') || source.includes('web-v1') ? [normalized] : [];
      });

    expect(existsSync(join(SOURCE_ROOT, 'web'))).toBe(false);
    expect(scriptViolations).toEqual([]);
    expect(activeFileViolations).toEqual([]);
  });

  it('keeps cli-v2 TUI/client code on the shared client API boundary', () => {
    const violations = findResolvedImportViolations(
      sourceFiles.filter((file) => isCliV2TuiClientSource(file)),
      (resolvedPath) => resolvedPath.startsWith('core/') || resolvedPath.startsWith('server/'),
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

function isCliV2TuiClientSource(file: string): boolean {
  const sourcePath = toSourcePath(file);
  return sourcePath.startsWith('cli-v2/')
    && !sourcePath.startsWith('cli-v2/commands/')
    && sourcePath !== 'cli-v2/main.ts';
}

function findImportViolations(files: string[], disallowed: RegExp[]): string[] {
  return files.flatMap((file) => {
    const imports = readImports(file)
      .filter((specifier) => disallowed.some((pattern) => pattern.test(specifier)));

    return imports.map((specifier) => `${toSourcePath(file)} imports ${specifier}`);
  });
}

function findResolvedImportViolations(files: string[], isDisallowed: (resolvedPath: string) => boolean): string[] {
  return files.flatMap((file) => {
    const imports = readImports(file)
      .map((specifier) => ({
        specifier,
        resolvedPath: resolveImportSpecifier(file, specifier),
      }))
      .filter((entry): entry is { specifier: string; resolvedPath: string } => Boolean(entry.resolvedPath))
      .filter((entry) => isDisallowed(entry.resolvedPath));

    return imports.map((entry) => `${toSourcePath(file)} imports ${entry.specifier}`);
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

function resolveImportSpecifier(file: string, specifier: string): string | undefined {
  const normalizedSpecifier = normalizeImportSpecifier(specifier);
  if (normalizedSpecifier.startsWith('@/')) {
    return normalizedSpecifier.slice(2);
  }

  if (!normalizedSpecifier.startsWith('.')) {
    return undefined;
  }

  return relative(SOURCE_ROOT, join(dirname(file), normalizedSpecifier)).split(sep).join('/');
}

function isProductionSource(file: string): boolean {
  return !toSourcePath(file).startsWith('__tests__/');
}

function toSourcePath(file: string): string {
  return relative(SOURCE_ROOT, file).split(sep).join('/');
}
