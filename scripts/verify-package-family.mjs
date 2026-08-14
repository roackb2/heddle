import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTHOR = 'Jay / Fienna Liang <roackb2@gmail.com>';
const REPOSITORY_URL = 'git+https://github.com/roackb2/heddle.git';
const HOMEPAGE = 'https://heddleagent.com';
const BUGS_URL = 'https://github.com/roackb2/heddle/issues';
const FOUNDATION_STATUS =
  'Status: **private package foundation; not published or installable**';

export const PACKAGE_DEFINITIONS = [
  {
    directory: 'runtime',
    name: '@heddleagent/runtime',
    description:
      'Embeddable TypeScript and Node.js agent runtime and SDK for Heddle-powered products',
    node: true,
    files: ['LICENSE', 'README.md', 'package.json'],
  },
  {
    directory: 'cli',
    name: '@heddleagent/cli',
    description:
      'Heddle coding-agent CLI, daemon, and local browser control-plane product',
    node: true,
    files: ['LICENSE', 'README.md', 'package.json'],
  },
  {
    directory: 'run-client',
    name: '@heddleagent/run-client',
    description:
      'Browser-safe JavaScript protocol and transport clients for consuming Heddle runs',
    node: false,
    files: ['LICENSE', 'README.md', 'package.json'],
  },
  {
    directory: 'execution-host-client',
    name: '@heddleagent/execution-host-client',
    description:
      'Product-backend contracts and helpers for invoking compatible Heddle Execution Hosts',
    node: true,
    files: ['LICENSE', 'README.md', 'package.json'],
  },
  {
    directory: 'postgres',
    name: '@heddleagent/postgres',
    description:
      'Official PostgreSQL adapters for supported Heddle-owned durable storage ports',
    node: true,
    files: [
      'LICENSE',
      'README.md',
      'durable-port-support.json',
      'package.json',
    ],
  },
];

export const DURABLE_PORT_REQUIREMENTS = [
  { id: 'conversation-sessions', status: 'launch-required' },
  { id: 'conversation-archives', status: 'launch-required' },
  { id: 'heartbeat-task-authority', status: 'launch-required' },
  {
    id: 'execution-host-conversation-lifecycle',
    status: 'launch-required',
  },
  { id: 'result-artifacts', status: 'excluded' },
  { id: 'standalone-heartbeat-checkpoint', status: 'excluded' },
  { id: 'agent-skill-activation', status: 'excluded' },
  { id: 'mcp-workspace-stores', status: 'excluded' },
  { id: 'active-run-coordination', status: 'excluded' },
  { id: 'local-machine-sensitive-state', status: 'excluded' },
];

export function createFoundationManifest(definition, nodeVersion) {
  return {
    name: definition.name,
    version: '0.0.0',
    private: true,
    description: definition.description,
    author: AUTHOR,
    license: 'MIT',
    type: 'module',
    repository: {
      type: 'git',
      url: REPOSITORY_URL,
      directory: `packages/${definition.directory}`,
    },
    homepage: HOMEPAGE,
    bugs: {
      url: BUGS_URL,
    },
    ...(definition.node ? { engines: { node: nodeVersion } } : {}),
  };
}

export function assertFoundationManifest(
  packageJson,
  definition,
  nodeVersion,
) {
  assert.deepEqual(
    packageJson,
    createFoundationManifest(definition, nodeVersion),
    `${definition.name} must remain an exact private metadata-only foundation.`,
  );
}

export function assertDurablePortInventory(inventory) {
  assert.equal(
    inventory.schemaVersion,
    1,
    'The durable-port inventory must use schema version 1.',
  );
  assert.ok(
    Array.isArray(inventory.ports),
    'The durable-port inventory must contain a ports array.',
  );

  const expectedRequirements = new Map(
    DURABLE_PORT_REQUIREMENTS.map(({ id, status }) => [id, status]),
  );
  const actualIds = inventory.ports.map(({ id }) => id);
  assert.equal(
    new Set(actualIds).size,
    actualIds.length,
    'The durable-port inventory must not contain duplicate IDs.',
  );
  assert.deepEqual(
    [...actualIds].sort(),
    [...expectedRequirements.keys()].sort(),
    'The durable-port inventory must contain exactly the reviewed Heddle state surfaces.',
  );

  for (const port of inventory.ports) {
    const expectedStatus = expectedRequirements.get(port.id);
    assert.equal(
      port.v6Status,
      expectedStatus,
      `${port.id} must retain its reviewed v6 launch status.`,
    );

    for (const field of [
      'contract',
      'ownerPackage',
      'currentEvidence',
      'publicSurface',
      'currentAdapter',
      'consistency',
      'migrationOwner',
    ]) {
      assertNonEmptyString(port[field], `${port.id}.${field}`);
    }

    if (port.v6Status === 'launch-required') {
      assertNonEmptyString(port.conformance, `${port.id}.conformance`);
      assertNonEmptyString(
        port.implementationGate,
        `${port.id}.implementationGate`,
      );
      assert.equal(
        port.exclusionRationale,
        undefined,
        `${port.id} is launch-required and cannot also claim exclusion.`,
      );
      continue;
    }

    assertNonEmptyString(
      port.exclusionRationale,
      `${port.id}.exclusionRationale`,
    );
    assert.equal(
      port.implementationGate,
      undefined,
      `${port.id} is excluded and must not imply an implementation gate in this launch.`,
    );
  }
}

export function verifyPackageFamily(
  repositoryUrl = new URL('../', import.meta.url),
) {
  const rootPackage = readJson(new URL('package.json', repositoryUrl));
  const rootLicense = readFileSync(new URL('LICENSE', repositoryUrl), 'utf8');

  assert.equal(
    rootPackage.workspaces,
    undefined,
    'The package foundation must not introduce a workspace/build-tool migration.',
  );

  for (const definition of PACKAGE_DEFINITIONS) {
    const directoryUrl = new URL(
      `packages/${definition.directory}/`,
      repositoryUrl,
    );
    const packageJson = readJson(new URL('package.json', directoryUrl));

    assertFoundationManifest(
      packageJson,
      definition,
      rootPackage.engines.node,
    );
    assert.deepEqual(
      readdirSync(directoryUrl).sort(),
      definition.files,
      `${definition.name} must not contain implementation or build output yet.`,
    );
    assert.equal(
      readFileSync(new URL('LICENSE', directoryUrl), 'utf8'),
      rootLicense,
      `${definition.name} must ship the repository license without drift.`,
    );

    const readme = readFileSync(new URL('README.md', directoryUrl), 'utf8');
    assert.ok(
      readme.startsWith(`# \`${definition.name}\`\n`),
      `${definition.name} must use its exact package coordinate as the README title.`,
    );
    assert.ok(
      readme.includes(FOUNDATION_STATUS),
      `${definition.name} must state that it is private and unpublished.`,
    );
  }

  const expectedFoundationNames = PACKAGE_DEFINITIONS
    .map(({ name }) => name)
    .sort();
  const actualFoundationNames = readdirSync(
    new URL('packages/', repositoryUrl),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readJson(
          new URL(`packages/${entry.name}/package.json`, repositoryUrl),
        ).name;
      } catch {
        return undefined;
      }
    })
    .filter((name) => name?.startsWith('@heddleagent/'))
    .sort();

  assert.deepEqual(
    actualFoundationNames,
    expectedFoundationNames,
    'The @heddleagent scope must contain exactly the approved private package foundations.',
  );

  const legacyPackages = new Map([
    [new URL('package.json', repositoryUrl), '@roackb2/heddle'],
    [
      new URL('packages/heddle-remote/package.json', repositoryUrl),
      '@roackb2/heddle-remote',
    ],
    [
      new URL('packages/heddle-adopter/package.json', repositoryUrl),
      '@roackb2/heddle-adopter',
    ],
    [
      new URL('packages/heddle-postgres/package.json', repositoryUrl),
      '@roackb2/heddle-postgres',
    ],
  ]);

  for (const [packageUrl, expectedName] of legacyPackages) {
    assert.equal(
      readJson(packageUrl).name,
      expectedName,
      `${expectedName} must remain available until its verified replacement is released.`,
    );
  }

  assertDurablePortInventory(
    readJson(
      new URL(
        'packages/postgres/durable-port-support.json',
        repositoryUrl,
      ),
    ),
  );

  process.stdout.write(
    `Verified ${PACKAGE_DEFINITIONS.length} private @heddleagent package foundations and ${DURABLE_PORT_REQUIREMENTS.length} durable-state decisions.\n`,
  );
}

function assertNonEmptyString(value, field) {
  assert.equal(typeof value, 'string', `${field} must be a string.`);
  assert.notEqual(value.trim(), '', `${field} must not be empty.`);
}

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyPackageFamily();
}
