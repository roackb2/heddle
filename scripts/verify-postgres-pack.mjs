import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import {
  NPM_REGISTRY,
  assertDistTagTransition,
  assertRegistryArtifactMatches,
  parseNpmViewResult,
  parseRegistryArtifactResult,
} from './execution-host-client-release-state.mjs';
import { parseNpmPackResult } from './execution-host-client-pack-result.mjs';
import { createPostgresReleaseMetadata } from './postgres-release-state.mjs';
import {
  POSTGRES_PACKAGE_NAME,
  POSTGRES_PACKAGE_VERSION,
  verifyPostgresPackage,
} from './verify-postgres-package.mjs';

const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));
const packageDirectory = fileURLToPath(
  new URL('../packages/postgres/', import.meta.url),
);
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), 'heddle-postgres-pack-'),
);
const commandEnvironment = {
  ...process.env,
  npm_config_cache: join(temporaryDirectory, 'npm-cache'),
};
const publishIfMissing = process.argv.includes('--publish-if-missing');
const verifyRegistry = process.argv.includes('--verify-registry');
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
  verifyPostgresPackage(new URL('../', import.meta.url), {
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
  const packed = parseNpmPackResult(pack.stdout, POSTGRES_PACKAGE_NAME);
  assert.equal(packed.name, POSTGRES_PACKAGE_NAME);
  assert.equal(packed.version, POSTGRES_PACKAGE_VERSION);

  const packedPaths = new Set(packed.files.map(({ path }) => path));
  for (const required of [
    'README.md',
    'LICENSE',
    'package.json',
    'dist/execution-host/conversations/index.js',
    'dist/execution-host/conversations/index.d.ts',
    'migrations/execution-host/conversations/0000_turn_lifecycle.sql',
  ]) {
    assert.ok(packedPaths.has(required), `${required} is missing from the tarball.`);
  }
  assert.ok(
    [...packedPaths].every(
      (path) =>
        ['README.md', 'LICENSE', 'package.json'].includes(path)
        || path.startsWith('dist/')
        || path.startsWith('migrations/'),
    ),
    'The tarball must not contain source, tests, examples, or build scripts.',
  );

  const packageJson = JSON.parse(
    readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
  );
  for (const target of exportTargets(packageJson.exports)) {
    assert.ok(
      packedPaths.has(target.slice(2)),
      `Packed export target ${target} is missing.`,
    );
  }

  const releaseMetadata = createPostgresReleaseMetadata(packageJson);
  const tarball = join(temporaryDirectory, packed.filename);
  verifyFreshConsumer(tarball, 'local-tarball-consumer');

  if (publishIfMissing || verifyRegistry) {
    registryOutcome = await verifyRegistryRelease({
      packed,
      tarball,
      releaseMetadata,
      publishIfMissing,
    });
  }

  process.stdout.write(
    `${describeOutcome(registryOutcome)} ${POSTGRES_PACKAGE_NAME}@${POSTGRES_PACKAGE_VERSION} in a fresh runtime and TypeScript consumer.\n`,
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
      '@heddleagent/execution-host-client@6.0.0',
      'drizzle-orm@0.45.2',
      'pg@8.22.0',
      '@types/pg@8.20.0',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--registry',
      NPM_REGISTRY,
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
          // Drizzle publishes optional-driver declarations for every backend.
          // Check this package's public types without requiring unrelated SQL
          // driver peers such as mysql2 or gel in a PostgreSQL consumer.
          skipLibCheck: true,
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

function runtimeSmokeSource() {
  return `
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  createPostgresHostedConversationTurnLifecycleStore,
  executionHostConversationPostgresMigrationSqlUrls,
  postgresExecutionHostConversationTurns,
} from '@heddleagent/postgres/execution-host/conversations'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

if (typeof createPostgresHostedConversationTurnLifecycleStore !== 'function') {
  throw new Error('The lifecycle store factory failed to load.')
}
if (!postgresExecutionHostConversationTurns ||
    executionHostConversationPostgresMigrationSqlUrls.length !== 1) {
  throw new Error('The PostgreSQL schema or ordered migrations failed to load.')
}
const sql = readFileSync(executionHostConversationPostgresMigrationSqlUrls[0], 'utf8')
if (!sql.includes('execution_host_conversation_turns')) {
  throw new Error('The packed lifecycle migration is invalid.')
}

if (process.env.HEDDLE_POSTGRES_TEST_URL) {
  const pool = new Pool({ connectionString: process.env.HEDDLE_POSTGRES_TEST_URL })
  const database = drizzle(pool)
  const store = createPostgresHostedConversationTurnLifecycleStore({ database })
  const invocationId = 'packed-' + randomUUID()
  const scope = {
    tenantId: 'packed-tenant',
    subjectId: 'packed-subject',
    productSessionId: 'packed-session',
  }
  try {
    await store.createTurn({
      invocationId,
      scope,
      prompt: 'Verify the exact packed adapter against PostgreSQL.',
      requestedAt: '2026-08-14T07:00:00.000Z',
    })
    await store.recordAccepted({
      invocationId,
      scope,
      runId: 'packed-run',
      acceptedAt: '2026-08-14T07:00:01.000Z',
    })
    await store.settleTurn({
      invocationId,
      scope,
      status: 'completed',
      summary: 'Packed adapter passed.',
      settledAt: '2026-08-14T07:00:02.000Z',
    })
    const [row] = await database.select().from(
      postgresExecutionHostConversationTurns,
    ).where(eq(postgresExecutionHostConversationTurns.invocationId, invocationId))
    if (row?.status !== 'completed' || row.summary !== 'Packed adapter passed.') {
      throw new Error('The packed lifecycle adapter did not settle durably.')
    }
  } finally {
    await database.delete(postgresExecutionHostConversationTurns).where(
      eq(postgresExecutionHostConversationTurns.invocationId, invocationId),
    )
    await pool.end()
  }
}
`;
}

function typesSmokeSource() {
  return `
import {
  createPostgresHostedConversationTurnLifecycleStore,
  executionHostConversationPostgresMigrationSqlUrls,
  postgresExecutionHostConversationTurns,
  type ExecutionHostConversationPostgresDatabase,
  type PostgresHostedConversationTurnLifecycleStore,
} from '@heddleagent/postgres/execution-host/conversations'
import type { HostedConversationTurnLifecycleStore } from
  '@heddleagent/execution-host-client/conversation'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

declare const database: NodePgDatabase
const accepted: ExecutionHostConversationPostgresDatabase = database
const store: PostgresHostedConversationTurnLifecycleStore =
  createPostgresHostedConversationTurnLifecycleStore({ database: accepted })
const contract: HostedConversationTurnLifecycleStore = store
void [contract, postgresExecutionHostConversationTurns,
  executionHostConversationPostgresMigrationSqlUrls]
`;
}

function exportTargets(exports) {
  return Object.values(exports).flatMap((entry) =>
    typeof entry === 'string' ? [entry] : Object.values(entry),
  );
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
      readDistTags(releaseMetadata.name).latest,
      releaseMetadata.version,
      'The latest dist-tag must identify the repository version.',
    );
    verifyRegistryConsumers(releaseMetadata);
    return 'already-published';
  }

  assert.equal(
    existsSync(join(repositoryDirectory, releaseMetadata.releaseNote)),
    true,
    `Release ${releaseMetadata.version} requires ${releaseMetadata.releaseNote}.`,
  );
  if (!publishIfMissing) return 'release-ready';

  assertPublicationContext(releaseMetadata);
  const distTagsBefore = readDistTagsIfPresent(releaseMetadata.name);
  const publishResult = publishTarball(tarball);
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

function publishTarball(tarball) {
  const result = spawnSync(
    'npm',
    [
      'publish',
      tarball,
      '--access',
      'public',
      '--tag',
      'latest',
      '--registry',
      NPM_REGISTRY,
    ],
    {
      cwd: repositoryDirectory,
      env: commandEnvironment,
      stdio: 'inherit',
    },
  );
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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const artifact = readRegistryArtifact(target);
    if (artifact.kind === 'published') return artifact;
    if (attempt < 119) await delay(5_000);
  }
  return { kind: 'missing' };
}

function readDistTags(packageName) {
  return parseNpmViewResult(
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
    `${packageName} dist-tags`,
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
  if (result.status === 0) {
    return parseNpmViewResult(result.stdout, `${packageName} dist-tags`);
  }
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
    `${releaseMetadata.name}@latest`,
    'registry-channel-consumer',
  );
}

function describeOutcome(outcome) {
  return {
    packed: 'Verified packed',
    'release-ready': 'Verified release-ready',
    'already-published': 'Verified existing registry artifact',
    published: 'Published and verified',
  }[outcome];
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
