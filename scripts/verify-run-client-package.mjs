import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUN_CLIENT_PACKAGE_NAME = '@heddleagent/run-client';
export const RUN_CLIENT_PACKAGE_VERSION = '6.0.0';

export function createRunClientManifest(rootPackage) {
  return {
    name: RUN_CLIENT_PACKAGE_NAME,
    version: RUN_CLIENT_PACKAGE_VERSION,
    description:
      'Browser-safe protocol and run-consumer services for Heddle conversations',
    author: 'Jay / Fienna Liang <roackb2@gmail.com>',
    license: 'MIT',
    type: 'module',
    sideEffects: false,
    publishConfig: {
      access: 'public',
      tag: 'latest',
      registry: 'https://registry.npmjs.org/',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/roackb2/heddle.git',
      directory: 'packages/run-client',
    },
    homepage: 'https://heddleagent.com',
    bugs: {
      url: 'https://github.com/roackb2/heddle/issues',
    },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
      './http-sse': {
        types: './dist/http-sse/index.d.ts',
        import: './dist/http-sse/index.js',
      },
      './package.json': './package.json',
    },
    files: ['dist', 'README.md', 'LICENSE'],
    keywords: [
      'agent',
      'ai-agent',
      'browser',
      'conversation',
      'sdk',
      'streaming',
    ],
    dependencies: {
      '@standard-schema/spec': rootPackage.dependencies['@standard-schema/spec'],
      'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
      zod: rootPackage.dependencies.zod,
    },
  };
}

export function assertRunClientManifest(packageJson, rootPackage) {
  assert.deepEqual(
    packageJson,
    createRunClientManifest(rootPackage),
    `${RUN_CLIENT_PACKAGE_NAME} must remain the exact browser-safe release artifact.`,
  );
  assert.equal(
    rootPackage.exports['./remote'],
    undefined,
    'The root package must not recreate the run client as an install-heavy subpath.',
  );
}

export function verifyRunClientPackage(
  repositoryUrl = new URL('../', import.meta.url),
  { writeOutput = true } = {},
) {
  const rootPackage = readPackage(new URL('package.json', repositoryUrl));
  const packageDirectory = new URL('packages/run-client/', repositoryUrl);
  const packageJson = readPackage(new URL('package.json', packageDirectory));

  assertRunClientManifest(packageJson, rootPackage);
  assert.equal(
    readFileSync(new URL('LICENSE', packageDirectory), 'utf8'),
    readFileSync(new URL('LICENSE', repositoryUrl), 'utf8'),
    'The run client must ship the repository license without drift.',
  );
  assert.equal(
    existsSync(new URL('src/core/chat/remote/index.ts', repositoryUrl)),
    true,
    'The existing run-client implementation must remain the canonical source during the package-only move.',
  );
  assert.equal(
    existsSync(new URL('packages/heddle-remote/', repositoryUrl)),
    false,
    'The legacy package directory must not duplicate the release artifact.',
  );

  if (writeOutput) {
    process.stdout.write(
      `Verified ${RUN_CLIENT_PACKAGE_NAME}@${RUN_CLIENT_PACKAGE_VERSION} as the stable package.\n`,
    );
  }
}

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyRunClientPackage();
}
