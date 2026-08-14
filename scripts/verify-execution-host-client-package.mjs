import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXECUTION_HOST_CLIENT_NAME =
  '@heddleagent/execution-host-client';
export const EXECUTION_HOST_CLIENT_VERSION = '6.0.0-next.1';

const EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    import: './dist/index.js',
  },
  './contracts': {
    types: './dist/contracts/index.d.ts',
    import: './dist/contracts/index.js',
  },
  './authority': {
    types: './dist/authority/index.d.ts',
    import: './dist/authority/index.js',
  },
  './conversation': {
    types: './dist/conversation/index.d.ts',
    import: './dist/conversation/index.js',
  },
  './mcp': {
    types: './dist/mcp/index.d.ts',
    import: './dist/mcp/index.js',
  },
  './mcp/node': {
    types: './dist/mcp/node/index.d.ts',
    import: './dist/mcp/node/index.js',
  },
  './http-sse': {
    types: './dist/http-sse/index.d.ts',
    import: './dist/http-sse/index.js',
  },
  './testing': {
    types: './dist/testing/index.d.ts',
    import: './dist/testing/index.js',
  },
  './node': {
    types: './dist/node/index.d.ts',
    import: './dist/node/index.js',
  },
  './spec/v1/openapi.json': './spec/v1/openapi.json',
  './spec/v1/schema-bundle.json': './spec/v1/schema-bundle.json',
  './spec/v1/fixtures/*': './spec/v1/fixtures/*',
  './package.json': './package.json',
};

export function createExecutionHostClientManifest(rootPackage) {
  return {
    name: EXECUTION_HOST_CLIENT_NAME,
    version: EXECUTION_HOST_CLIENT_VERSION,
    description:
      'Backend contracts, execution authority, lifecycle services, and clients for compatible Heddle Execution Hosts',
    author: 'Jay / Fienna Liang <roackb2@gmail.com>',
    license: 'MIT',
    type: 'module',
    sideEffects: false,
    publishConfig: {
      access: 'public',
      tag: 'next',
      registry: 'https://registry.npmjs.org/',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/roackb2/heddle.git',
      directory: 'packages/execution-host-client',
    },
    homepage: 'https://heddleagent.com',
    bugs: {
      url: 'https://github.com/roackb2/heddle/issues',
    },
    engines: {
      node: rootPackage.engines.node,
    },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: EXPORTS,
    files: ['dist', 'spec', 'README.md', 'LICENSE'],
    keywords: [
      'agent',
      'ai-agent',
      'backend',
      'execution-host',
      'mcp',
      'sdk',
      'streaming',
    ],
    dependencies: {
      '@modelcontextprotocol/sdk':
        rootPackage.dependencies['@modelcontextprotocol/sdk'],
      dayjs: rootPackage.dependencies.dayjs,
      'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
      jose: rootPackage.devDependencies.jose,
      zod: rootPackage.dependencies.zod,
    },
  };
}

export function assertExecutionHostClientManifest(
  packageJson,
  rootPackage,
) {
  assert.deepEqual(
    packageJson,
    createExecutionHostClientManifest(rootPackage),
    `${EXECUTION_HOST_CLIENT_NAME} must remain the exact verified prerelease artifact.`,
  );
  assert.equal(
    rootPackage.exports['./adopter'],
    undefined,
    'The root package must not recreate the Execution Host client as an install-heavy subpath.',
  );
  assert.equal(
    rootPackage.exports['./execution-host-client'],
    undefined,
    'The root package must not recreate the Execution Host client under a second subpath.',
  );
}

export function verifyExecutionHostClientPackage(
  repositoryUrl = new URL('../', import.meta.url),
  { writeOutput = true } = {},
) {
  const rootPackage = readPackage(new URL('package.json', repositoryUrl));
  const packageDirectory = new URL(
    'packages/execution-host-client/',
    repositoryUrl,
  );
  const packageJson = readPackage(new URL('package.json', packageDirectory));

  assertExecutionHostClientManifest(packageJson, rootPackage);
  assert.equal(
    readFileSync(new URL('LICENSE', packageDirectory), 'utf8'),
    readFileSync(new URL('LICENSE', repositoryUrl), 'utf8'),
    'The Execution Host client must ship the repository license without drift.',
  );
  assert.equal(
    existsSync(new URL('src/index.ts', packageDirectory)),
    true,
    'The activated package must contain its canonical implementation.',
  );
  assert.equal(
    existsSync(new URL('packages/heddle-adopter/', repositoryUrl)),
    false,
    'The legacy source directory must not duplicate the canonical implementation.',
  );

  if (writeOutput) {
    process.stdout.write(
      `Verified ${EXECUTION_HOST_CLIENT_NAME}@${EXECUTION_HOST_CLIENT_VERSION} as the next-channel package.\n`,
    );
  }
}

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyExecutionHostClientPackage();
}
