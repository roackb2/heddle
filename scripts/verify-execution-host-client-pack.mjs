import assert from 'node:assert/strict';
import {
  existsSync,
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
import {
  NPM_REGISTRY,
  assertDistTagTransition,
  assertRegistryArtifactMatches,
  createExecutionHostClientReleaseMetadata,
  parseRegistryArtifactResult,
} from './execution-host-client-release-state.mjs';

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
const publishIfMissing = process.argv.includes('--publish-if-missing');
const verifyRegistry = process.argv.includes('--verify-registry');
const mutationRequested = publishIfMissing;
const acceptedArguments = publishIfMissing
  ? ['--publish-if-missing']
  : verifyRegistry
    ? ['--verify-registry']
    : [];

assert.deepEqual(
  process.argv.slice(2),
  acceptedArguments,
  'The pack verifier accepts only one explicit registry mode.',
);

let registryOutcome = 'packed';

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
  const [packed] = JSON.parse(pack.stdout);

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
  const releaseMetadata =
    createExecutionHostClientReleaseMetadata(packageJson);
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

  if (mutationRequested || verifyRegistry) {
    registryOutcome = await verifyRegistryRelease({
      packed,
      tarball,
      releaseMetadata,
      publishIfMissing,
    });
  }

  process.stdout.write(
    `${describeOutcome(registryOutcome)} ${EXECUTION_HOST_CLIENT_NAME}@${EXECUTION_HOST_CLIENT_VERSION} in a fresh runtime and TypeScript consumer.\n`,
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

async function verifyRegistryRelease({
  packed,
  tarball,
  releaseMetadata,
  publishIfMissing,
}) {
  const target = `${releaseMetadata.name}@${releaseMetadata.version}`;
  let artifact = readRegistryArtifact(target);

  if (artifact.kind === 'published') {
    assertRegistryArtifactMatches(artifact, {
      version: releaseMetadata.version,
      integrity: packed.integrity,
    });
    assert.equal(
      readDistTags(releaseMetadata.name)[releaseMetadata.publishTag],
      releaseMetadata.version,
      `The ${releaseMetadata.publishTag} dist-tag must identify the repository version.`,
    );
    verifyRegistryConsumers(releaseMetadata);
    return 'already-published';
  }

  assert.equal(
    existsSync(join(repositoryDirectory, releaseMetadata.releaseNote)),
    true,
    `Release ${releaseMetadata.version} requires ${releaseMetadata.releaseNote}.`,
  );
  if (!publishIfMissing) return 'release-candidate';

  assertPublicationContext(releaseMetadata);
  const distTagsBefore = readDistTagsIfPresent(releaseMetadata.name);
  const publishResult = publishTarball(tarball, releaseMetadata);
  artifact = await waitForRegistryArtifact(target);

  if (artifact.kind === 'missing') {
    throw new Error(
      `npm publish did not make ${target} publicly visible. Exit status: ${publishResult.status ?? 'unknown'}.`,
    );
  }

  assertRegistryArtifactMatches(artifact, {
    version: releaseMetadata.version,
    integrity: packed.integrity,
  });
  assertDistTagTransition({
    before: distTagsBefore,
    after: readDistTags(releaseMetadata.name),
    publishTag: releaseMetadata.publishTag,
    version: releaseMetadata.version,
  });
  verifyRegistryConsumers(releaseMetadata);
  return 'published';
}

function assertPublicationContext(releaseMetadata) {
  assert.equal(
    run('git', ['status', '--porcelain'], repositoryDirectory).stdout,
    '',
    'Publication requires a clean worktree for commit, tag, and registry-integrity traceability.',
  );
  const tagsAtHead = run(
    'git',
    ['tag', '--points-at', 'HEAD'],
    repositoryDirectory,
  ).stdout.split('\n');
  assert.ok(
    tagsAtHead.includes(releaseMetadata.releaseTag),
    `Publication requires annotated tag ${releaseMetadata.releaseTag} on HEAD.`,
  );
  assert.equal(
    run(
      'git',
      ['cat-file', '-t', `refs/tags/${releaseMetadata.releaseTag}`],
      repositoryDirectory,
    ).stdout.trim(),
    'tag',
    `Release tag ${releaseMetadata.releaseTag} must be annotated.`,
  );

  if (process.env.GITHUB_ACTIONS === 'true') {
    assert.equal(process.env.GITHUB_REPOSITORY, 'roackb2/heddle');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.equal(
      process.env.GITHUB_SHA,
      run('git', ['rev-parse', 'HEAD'], repositoryDirectory).stdout.trim(),
      'GitHub Actions must publish the exact checked-out main commit.',
    );
    assert.ok(
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      'GitHub Actions publication requires id-token: write for npm trusted publishing.',
    );
    return;
  }

  assert.equal(
    run(
      'npm',
      ['whoami', '--registry', NPM_REGISTRY],
      repositoryDirectory,
    ).stdout.trim(),
    'roackb2',
    'Manual recovery publication must use the npm account that owns @heddleagent.',
  );
}

function publishTarball(tarball, releaseMetadata) {
  const args = [
    'publish',
    tarball,
    '--access',
    'public',
    '--tag',
    releaseMetadata.publishTag,
    '--registry',
    NPM_REGISTRY,
  ];
  const result = spawnSync('npm', args, {
    cwd: repositoryDirectory,
    env: commandEnvironment,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  return result;
}

function readRegistryArtifact(target) {
  return parseRegistryArtifactResult(
    runResult(
      'npm',
      [
        'view',
        target,
        'version',
        'dist.integrity',
        '--json',
        '--registry',
        NPM_REGISTRY,
        '--prefer-online',
      ],
      repositoryDirectory,
    ),
    target,
  );
}

async function waitForRegistryArtifact(target) {
  const attempts = 120;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const artifact = readRegistryArtifact(target);
    if (artifact.kind === 'published') return artifact;
    if (attempt < attempts - 1) await delay(5_000);
  }
  return { kind: 'missing' };
}

function readDistTags(packageName) {
  return JSON.parse(
    run(
      'npm',
      [
        'view',
        packageName,
        'dist-tags',
        '--json',
        '--registry',
        NPM_REGISTRY,
        '--prefer-online',
      ],
      repositoryDirectory,
    ).stdout,
  );
}

function readDistTagsIfPresent(packageName) {
  const result = runResult(
    'npm',
    [
      'view',
      packageName,
      'dist-tags',
      '--json',
      '--registry',
      NPM_REGISTRY,
      '--prefer-online',
    ],
    repositoryDirectory,
  );
  if (result.status === 0) return JSON.parse(result.stdout);

  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /E404|404 Not Found/,
    `Registry dist-tag lookup for ${packageName} failed for a reason other than an absent package.`,
  );
  return {};
}

function verifyRegistryConsumers(releaseMetadata) {
  verifyFreshConsumer(
    `${releaseMetadata.name}@${releaseMetadata.version}`,
    'registry-exact-consumer',
  );
  verifyFreshConsumer(
    `${releaseMetadata.name}@${releaseMetadata.publishTag}`,
    'registry-channel-consumer',
  );
}

function describeOutcome(outcome) {
  const descriptions = {
    packed: 'Verified packed',
    'release-candidate': 'Verified unpublished release candidate',
    'already-published': 'Verified existing registry artifact',
    published: 'Published and verified',
  };
  return descriptions[outcome];
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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
