import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { parseNpmPackResult } from './execution-host-client-pack-result.mjs';
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
assert.deepEqual(
  process.argv.slice(2),
  [],
  'The pack verifier accepts no arguments and never publishes.',
);

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
    'dist/heartbeat/index.js',
    'dist/heartbeat/index.d.ts',
    'dist/heartbeat/schema.js',
    'migrations/heartbeat/0000_heartbeat_authority.sql',
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

  const tarball = join(temporaryDirectory, packed.filename);
  verifyFreshConsumer(tarball, 'local-tarball-consumer');

  process.stdout.write(
    `Verified packed ${POSTGRES_PACKAGE_NAME}@${POSTGRES_PACKAGE_VERSION} in a fresh runtime and TypeScript consumer.\n`,
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
      '@heddleagent/runtime@6.1.0',
      'drizzle-orm@0.45.2',
      'pg@8.22.0',
      '@types/pg@8.20.0',
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
  createPostgresHeartbeatTaskAuthority,
  heartbeatPostgresMigrationSqlUrl,
  postgresHeartbeatTasks,
} from '@heddleagent/postgres/heartbeat'
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
if (typeof createPostgresHeartbeatTaskAuthority !== 'function' ||
    !postgresHeartbeatTasks) {
  throw new Error('The heartbeat authority failed to load.')
}
if (!postgresExecutionHostConversationTurns ||
    executionHostConversationPostgresMigrationSqlUrls.length !== 1) {
  throw new Error('The PostgreSQL schema or ordered migrations failed to load.')
}
const sql = readFileSync(executionHostConversationPostgresMigrationSqlUrls[0], 'utf8')
if (!sql.includes('execution_host_conversation_turns')) {
  throw new Error('The packed lifecycle migration is invalid.')
}
const heartbeatSql = readFileSync(heartbeatPostgresMigrationSqlUrl, 'utf8')
if (!heartbeatSql.includes('heartbeat_tasks')) {
  throw new Error('The packed heartbeat migration is invalid.')
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
  createPostgresHeartbeatTaskAuthority,
  type HeartbeatPostgresDatabase,
  type PostgresHeartbeatTaskAuthority,
} from '@heddleagent/postgres/heartbeat'
import {
  createPostgresHostedConversationTurnLifecycleStore,
  executionHostConversationPostgresMigrationSqlUrls,
  postgresExecutionHostConversationTurns,
  type ExecutionHostConversationPostgresDatabase,
  type PostgresHostedConversationTurnLifecycleStore,
} from '@heddleagent/postgres/execution-host/conversations'
import type { HostedConversationTurnLifecycleStore } from
  '@heddleagent/execution-host-client/conversation'
import type { HeartbeatTargetedTaskStore } from '@heddleagent/runtime/advanced'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

declare const database: NodePgDatabase
const accepted: ExecutionHostConversationPostgresDatabase = database
const store: PostgresHostedConversationTurnLifecycleStore =
  createPostgresHostedConversationTurnLifecycleStore({ database: accepted })
const contract: HostedConversationTurnLifecycleStore = store
const heartbeatDatabase: HeartbeatPostgresDatabase = database
const heartbeat: PostgresHeartbeatTaskAuthority =
  createPostgresHeartbeatTaskAuthority({
    database: heartbeatDatabase,
    namespace: 'packed-consumer',
    executionLeaseMs: 60_000,
  })
const heartbeatStore: HeartbeatTargetedTaskStore = heartbeat.store
void [contract, heartbeatStore, postgresExecutionHostConversationTurns,
  executionHostConversationPostgresMigrationSqlUrls]
`;
}

function exportTargets(exports) {
  return Object.values(exports).flatMap((entry) =>
    typeof entry === 'string' ? [entry] : Object.values(entry),
  );
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
