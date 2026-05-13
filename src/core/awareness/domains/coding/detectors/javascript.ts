import type { CodingProjectSignalDetector } from './types.js';

const LOCKFILES = [
  { fileName: 'yarn.lock', kind: 'yarn_lock' },
  { fileName: 'package-lock.json', kind: 'npm_lock' },
  { fileName: 'pnpm-lock.yaml', kind: 'pnpm_lock' },
  { fileName: 'bun.lock', kind: 'bun_lock' },
  { fileName: 'bun.lockb', kind: 'bun_lockb' },
] as const;

export const javascriptProjectDetector: CodingProjectSignalDetector = {
  id: 'javascript',
  async detect(input) {
    const rootEntries = new Set(input.rootEntries);
    const hasPackageJson = rootEntries.has('package.json');
    const presentLockfiles = LOCKFILES.filter((lockfile) => rootEntries.has(lockfile.fileName));

    if (!hasPackageJson && presentLockfiles.length === 0) {
      return null;
    }

    const sources = [];
    const limits = [];
    const manifests = [];

    if (hasPackageJson) {
      manifests.push({
        kind: 'package_json',
        path: 'package.json',
      });
      sources.push({
        kind: 'package_metadata' as const,
        path: `${input.workspaceRoot}/package.json`,
      });
    }

    const lockfiles = presentLockfiles.map((lockfile) => ({
      kind: lockfile.kind,
      path: lockfile.fileName,
    }));

    const verificationSurfaces = [];
    if (hasPackageJson) {
      const packageJsonText = await input.readText('package.json');
      if (packageJsonText) {
        try {
          const parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
          const scriptNames = Object.keys(parsed.scripts ?? {}).sort();
          const verificationScriptNames = scriptNames.filter((name) =>
            /^(test|lint|build|typecheck|check|verify|e2e)(:|$)/.test(name)
          );
          if (verificationScriptNames.length > 0) {
            verificationSurfaces.push({
              kind: 'script_names' as const,
              label: 'package.json verification scripts',
              sourcePath: 'package.json',
              scriptNames: verificationScriptNames,
            });
          }
        } catch (error) {
          limits.push({
            kind: 'unavailable' as const,
            subject: 'package metadata',
            detail: `Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    const configFiles = input.rootEntries.filter((entry) => JAVASCRIPT_CONFIG_FILES.has(entry)).sort();

    return {
      project: {
        kind: 'javascript',
        manifests,
        lockfiles,
        verificationSurfaces,
      },
      configFiles,
      sources,
      limits,
    };
  },
};

const JAVASCRIPT_CONFIG_FILES = new Set([
  'tsconfig.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  'vitest.config.ts',
  'vite.config.ts',
  'jest.config.js',
  'jest.config.ts',
]);
