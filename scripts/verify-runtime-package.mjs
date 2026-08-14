import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_PACKAGE_NAME = '@heddleagent/runtime';
export const RUNTIME_PACKAGE_VERSION = '6.1.0';

const dependencies = (rootPackage) => ({
  '@anthropic-ai/sdk': rootPackage.dependencies['@anthropic-ai/sdk'],
  '@modelcontextprotocol/sdk': rootPackage.dependencies['@modelcontextprotocol/sdk'],
  '@trpc/server': rootPackage.dependencies['@trpc/server'],
  '@types/express': rootPackage.devDependencies['@types/express'],
  '@types/lodash': rootPackage.dependencies['@types/lodash'],
  '@types/multer': rootPackage.devDependencies['@types/multer'],
  '@types/node': rootPackage.devDependencies['@types/node'],
  '@types/proper-lockfile': rootPackage.devDependencies['@types/proper-lockfile'],
  'async-mutex': rootPackage.dependencies['async-mutex'],
  dayjs: rootPackage.dependencies.dayjs,
  'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
  express: rootPackage.dependencies.express,
  'gitdiff-parser': rootPackage.dependencies['gitdiff-parser'],
  lodash: rootPackage.dependencies.lodash,
  multer: rootPackage.dependencies.multer,
  openai: rootPackage.dependencies.openai,
  'p-limit': rootPackage.dependencies['p-limit'],
  pino: rootPackage.dependencies.pino,
  'pino-pretty': rootPackage.dependencies['pino-pretty'],
  'proper-lockfile': rootPackage.dependencies['proper-lockfile'],
  yaml: rootPackage.dependencies.yaml,
  zod: rootPackage.dependencies.zod,
});

export function createRuntimeManifest(rootPackage) {
  return {
    name: RUNTIME_PACKAGE_NAME,
    version: RUNTIME_PACKAGE_VERSION,
    description:
      'Embeddable TypeScript and Node.js agent runtime and SDK for Heddle-powered products',
    author: 'Jay / Fienna Liang <roackb2@gmail.com>',
    license: 'MIT',
    type: 'module',
    publishConfig: {
      access: 'public',
      tag: 'latest',
      registry: 'https://registry.npmjs.org/',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/roackb2/heddle.git',
      directory: 'packages/runtime',
    },
    homepage: 'https://heddleagent.com',
    bugs: {
      url: 'https://github.com/roackb2/heddle/issues',
    },
    engines: {
      node: rootPackage.engines.node,
    },
    main: './dist/src/index.js',
    types: './dist/src/index.d.ts',
    exports: {
      '.': {
        types: './dist/src/index.d.ts',
        import: './dist/src/index.js',
      },
      './runs': {
        types: './dist/src/hosted.d.ts',
        import: './dist/src/hosted.js',
      },
      './runs/http-sse': {
        types: './dist/src/hosted/http-sse.d.ts',
        import: './dist/src/hosted/http-sse.js',
      },
      './advanced': {
        types: './dist/src/advanced.d.ts',
        import: './dist/src/advanced.js',
      },
      './cli': {
        types: './dist/src/cli-runtime.d.ts',
        import: './dist/src/cli-runtime.js',
      },
      './heartbeat/testing': {
        types: './dist/src/heartbeat-testing.d.ts',
        import: './dist/src/heartbeat-testing.js',
      },
      './package.json': './package.json',
    },
    files: ['dist', 'README.md', 'LICENSE'],
    keywords: [
      'agent',
      'ai-agent',
      'agent-runtime',
      'agent-framework',
      'conversation',
      'heartbeat',
      'sdk',
    ],
    peerDependencies: rootPackage.peerDependencies,
    peerDependenciesMeta: rootPackage.peerDependenciesMeta,
    dependencies: dependencies(rootPackage),
  };
}

export function assertRuntimeManifest(packageJson, rootPackage) {
  assert.deepEqual(
    packageJson,
    createRuntimeManifest(rootPackage),
    `${RUNTIME_PACKAGE_NAME} must remain the exact embeddable runtime artifact.`,
  );
  assert.equal(
    packageJson.bin,
    undefined,
    'The runtime package must not ship the Heddle product executable.',
  );
  assert.equal(
    rootPackage.exports['./runtime'],
    undefined,
    'The root package must not recreate the new runtime as another subpath.',
  );
}

export function verifyRuntimePackage(
  repositoryUrl = new URL('../', import.meta.url),
  { writeOutput = true } = {},
) {
  const rootPackage = readPackage(new URL('package.json', repositoryUrl));
  const packageDirectory = new URL('packages/runtime/', repositoryUrl);
  const packageJson = readPackage(new URL('package.json', packageDirectory));

  assertRuntimeManifest(packageJson, rootPackage);
  assert.equal(
    readFileSync(new URL('LICENSE', packageDirectory), 'utf8'),
    readFileSync(new URL('LICENSE', repositoryUrl), 'utf8'),
    'The runtime package must ship the repository license without drift.',
  );
  for (const entrypoint of [
    'src/index.ts',
    'src/advanced.ts',
    'src/cli-runtime.ts',
    'src/hosted.ts',
    'src/hosted/http-sse.ts',
    'src/heartbeat-testing.ts',
  ]) {
    assert.equal(
      existsSync(new URL(entrypoint, repositoryUrl)),
      true,
      `The canonical runtime source entrypoint ${entrypoint} must exist.`,
    );
  }
  assert.equal(
    existsSync(new URL('packages/runtime/src/', repositoryUrl)),
    false,
    'The runtime package must compile the canonical source graph instead of duplicating it.',
  );

  if (writeOutput) {
    process.stdout.write(
      `Verified ${RUNTIME_PACKAGE_NAME}@${RUNTIME_PACKAGE_VERSION} as the stable embeddable runtime.\n`,
    );
  }
}

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyRuntimePackage();
}
