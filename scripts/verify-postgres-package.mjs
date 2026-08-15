import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXECUTION_HOST_CLIENT_VERSION,
} from './verify-execution-host-client-package.mjs';

export const POSTGRES_PACKAGE_NAME = '@heddleagent/postgres';
export const POSTGRES_PACKAGE_VERSION = '6.1.0';

export function createPostgresManifest(rootPackage) {
  return {
    name: POSTGRES_PACKAGE_NAME,
    version: POSTGRES_PACKAGE_VERSION,
    description:
      'Official PostgreSQL adapters for selected Heddle-owned domain persistence ports',
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
      directory: 'packages/postgres',
    },
    homepage: 'https://heddleagent.com',
    bugs: {
      url: 'https://github.com/roackb2/heddle/issues',
    },
    engines: {
      node: rootPackage.engines.node,
    },
    exports: {
      './heartbeat': {
        types: './dist/heartbeat/index.d.ts',
        import: './dist/heartbeat/index.js',
      },
      './heartbeat/schema': {
        types: './dist/heartbeat/schema.d.ts',
        import: './dist/heartbeat/schema.js',
      },
      './execution-host/conversations': {
        types: './dist/execution-host/conversations/index.d.ts',
        import: './dist/execution-host/conversations/index.js',
      },
      './package.json': './package.json',
    },
    files: ['dist', 'migrations', 'README.md', 'LICENSE'],
    keywords: [
      'agent',
      'heartbeat',
      'execution-host',
      'postgresql',
      'drizzle',
      'durability',
    ],
    peerDependencies: {
      '@heddleagent/execution-host-client':
        `>=${EXECUTION_HOST_CLIENT_VERSION} <7`,
      '@heddleagent/runtime': '>=6.0.0 <7',
      'drizzle-orm': `>=${rootPackage.devDependencies['drizzle-orm']} <1`,
    },
    peerDependenciesMeta: {
      '@heddleagent/execution-host-client': {
        optional: true,
      },
      '@heddleagent/runtime': {
        optional: true,
      },
    },
    dependencies: {
      dayjs: rootPackage.dependencies.dayjs,
    },
  };
}

export function assertPostgresManifest(packageJson, rootPackage) {
  assert.deepEqual(
    packageJson,
    createPostgresManifest(rootPackage),
    `${POSTGRES_PACKAGE_NAME} must remain the exact verified release artifact.`,
  );
  assert.equal(
    packageJson.exports['.'],
    undefined,
    'The PostgreSQL adapter family must not expose a generic root provider.',
  );
  assert.equal(
    rootPackage.exports['./postgres'],
    undefined,
    'The root runtime must not make PostgreSQL a core dependency.',
  );
}

export function verifyPostgresPackage(
  repositoryUrl = new URL('../', import.meta.url),
  { writeOutput = true } = {},
) {
  const rootPackage = readPackage(new URL('package.json', repositoryUrl));
  const packageDirectory = new URL('packages/postgres/', repositoryUrl);
  const packageJson = readPackage(new URL('package.json', packageDirectory));

  assertPostgresManifest(packageJson, rootPackage);
  assert.equal(
    readFileSync(new URL('LICENSE', packageDirectory), 'utf8'),
    readFileSync(new URL('LICENSE', repositoryUrl), 'utf8'),
    'The PostgreSQL package must ship the repository license without drift.',
  );
  for (const path of [
    'src/heartbeat/index.ts',
    'migrations/heartbeat/0000_heartbeat_authority.sql',
    'src/execution-host/conversations/index.ts',
    'migrations/execution-host/conversations/0000_turn_lifecycle.sql',
  ]) {
    assert.equal(
      existsSync(new URL(path, packageDirectory)),
      true,
      `${POSTGRES_PACKAGE_NAME} is missing ${path}.`,
    );
  }
  assert.equal(
    existsSync(new URL('packages/heddle-postgres/', repositoryUrl)),
    false,
    'The legacy PostgreSQL source package must not duplicate the consolidated adapter family.',
  );

  if (writeOutput) {
    process.stdout.write(
      `Verified ${POSTGRES_PACKAGE_NAME}@${POSTGRES_PACKAGE_VERSION} as the stable package.\n`,
    );
  }
}

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyPostgresPackage();
}
