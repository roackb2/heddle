import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  EXECUTION_HOST_CLIENT_NAME,
  EXECUTION_HOST_CLIENT_VERSION,
  verifyExecutionHostClientPackage,
} from './verify-execution-host-client-package.mjs';
import { parseNpmPackResult } from './execution-host-client-pack-result.mjs';

const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));
const packageDirectory = fileURLToPath(
  new URL('../packages/execution-host-client/', import.meta.url),
);
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), 'heddle-execution-host-client-pack-'),
);
const npmCacheDirectory = join(temporaryDirectory, 'npm-cache');
const commandEnvironment = {
  ...process.env,
  npm_config_cache: npmCacheDirectory,
};
assert.deepEqual(
  process.argv.slice(2),
  [],
  'The pack verifier accepts no arguments and never publishes.',
);

try {
  verifyExecutionHostClientPackage(new URL('../', import.meta.url), {
    writeOutput: false,
  });

  const pack = run(
    'npm',
    [
      'pack',
      packageDirectory,
      '--json',
      '--pack-destination',
      temporaryDirectory,
    ],
    repositoryDirectory,
  );
  const packed = parseNpmPackResult(pack.stdout, EXECUTION_HOST_CLIENT_NAME);

  assert.equal(packed.name, EXECUTION_HOST_CLIENT_NAME);
  assert.equal(packed.version, EXECUTION_HOST_CLIENT_VERSION);

  const packedPaths = new Set(packed.files.map(({ path }) => path));
  assert.ok(packedPaths.has('README.md'));
  assert.ok(packedPaths.has('LICENSE'));
  assert.ok(packedPaths.has('package.json'));
  assert.ok(
    [...packedPaths].every(
      (path) =>
        ['README.md', 'LICENSE', 'package.json'].includes(path) ||
        path.startsWith('dist/') ||
        path.startsWith('spec/'),
    ),
    'The tarball must not contain source, tests, examples, or build scripts.',
  );

  const fixtureManifest = JSON.parse(
    readFileSync(
      join(packageDirectory, 'spec/v1/fixtures/manifest.json'),
      'utf8',
    ),
  );
  for (const fixture of fixtureManifest.cases) {
    assert.ok(
      packedPaths.has(`spec/v1/fixtures/${fixture.file}`),
      `Conformance fixture ${fixture.file} is missing from the tarball.`,
    );
  }
  assert.ok(
    packedPaths.has('spec/v1/durable-hosted-conversation-lifecycle.md'),
    'The durable lifecycle specification is missing from the tarball.',
  );

  const packageJson = JSON.parse(
    readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
  );
  for (const target of exportTargets(packageJson.exports)) {
    if (target.includes('*')) {
      const [prefix, suffix] = target.slice(2).split('*');
      assert.ok(
        [...packedPaths].some(
          (path) => path.startsWith(prefix) && path.endsWith(suffix),
        ),
        `No packed file satisfies export target ${target}.`,
      );
      continue;
    }

    assert.ok(
      packedPaths.has(target.slice(2)),
      `Packed export target ${target} is missing.`,
    );
  }

  const tarball = join(temporaryDirectory, packed.filename);
  verifyFreshConsumer(tarball, 'local-tarball-consumer');

  process.stdout.write(
    `Verified packed ${EXECUTION_HOST_CLIENT_NAME}@${EXECUTION_HOST_CLIENT_VERSION} in a fresh runtime and TypeScript consumer.\n`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function verifyFreshConsumer(installSpec, directoryName) {
  const consumerDirectory = join(temporaryDirectory, directoryName);
  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  );
  run(
    'npm',
    [
      'install',
      installSpec,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--registry',
      'https://registry.npmjs.org/',
    ],
    consumerDirectory,
  );

  writeFileSync(
    join(consumerDirectory, 'runtime-smoke.mjs'),
    runtimeSmokeSource(),
  );
  run('node', ['runtime-smoke.mjs'], consumerDirectory);

  writeFileSync(
    join(consumerDirectory, 'types-smoke.ts'),
    typesSmokeSource(),
  );
  writeFileSync(
    join(consumerDirectory, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          resolveJsonModule: true,
          skipLibCheck: false,
          typeRoots: [join(repositoryDirectory, 'node_modules/@types')],
        },
        include: ['types-smoke.ts'],
      },
      null,
      2,
    ),
  );
  run(
    join(repositoryDirectory, 'node_modules/.bin/tsc'),
    ['-p', 'tsconfig.json'],
    consumerDirectory,
  );
}

function exportTargets(exports) {
  return Object.values(exports).flatMap((entry) =>
    typeof entry === 'string' ? [entry] : Object.values(entry),
  );
}

function runtimeSmokeSource() {
  return `
import * as root from '@heddleagent/execution-host-client'
import * as contracts from '@heddleagent/execution-host-client/contracts'
import * as authority from '@heddleagent/execution-host-client/authority'
import * as conversation from '@heddleagent/execution-host-client/conversation'
import * as mcp from '@heddleagent/execution-host-client/mcp'
import * as mcpNode from '@heddleagent/execution-host-client/mcp/node'
import * as httpSse from '@heddleagent/execution-host-client/http-sse'
import * as testing from '@heddleagent/execution-host-client/testing'
import * as node from '@heddleagent/execution-host-client/node'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const openapi = require('@heddleagent/execution-host-client/spec/v1/openapi.json')
const schema = require('@heddleagent/execution-host-client/spec/v1/schema-bundle.json')
const fixture = require('@heddleagent/execution-host-client/spec/v1/fixtures/manifest.json')

if ([root, contracts, authority, conversation, mcp, mcpNode, httpSse, testing, node]
  .some((entry) => typeof entry !== 'object')) throw new Error('A JavaScript export failed to load.')
if (!openapi.openapi || !schema.$schema || !fixture.cases) {
  throw new Error('A language-neutral contract artifact failed to load.')
}
`;
}

function typesSmokeSource() {
  return `
import * as root from '@heddleagent/execution-host-client'
import * as contracts from '@heddleagent/execution-host-client/contracts'
import * as authority from '@heddleagent/execution-host-client/authority'
import * as conversation from '@heddleagent/execution-host-client/conversation'
import * as mcp from '@heddleagent/execution-host-client/mcp'
import * as mcpNode from '@heddleagent/execution-host-client/mcp/node'
import * as httpSse from '@heddleagent/execution-host-client/http-sse'
import * as testing from '@heddleagent/execution-host-client/testing'
import * as node from '@heddleagent/execution-host-client/node'
import openapi from '@heddleagent/execution-host-client/spec/v1/openapi.json' with { type: 'json' }
import schema from '@heddleagent/execution-host-client/spec/v1/schema-bundle.json' with { type: 'json' }
import fixture from '@heddleagent/execution-host-client/spec/v1/fixtures/manifest.json' with { type: 'json' }

void [root, contracts, authority, conversation, mcp, mcpNode, httpSse, testing, node]
void [openapi, schema, fixture]
`;
}

function run(command, args, cwd) {
  const result = runResult(command, args, cwd);

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`,
    );
  }

  return result;
}

function runResult(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: commandEnvironment,
  });
}
