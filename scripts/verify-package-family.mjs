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
      'Official PostgreSQL adapters for selected Heddle-owned domain persistence ports',
    node: true,
    files: [
      'LICENSE',
      'README.md',
      'durable-port-support.json',
      'package.json',
    ],
  },
];

export const POSTGRES_ADAPTER_REQUIREMENTS = [
  {
    id: 'conversation-sessions',
    portContracts: ['ChatSessionRepository'],
    launchPolicy: 'required',
    implementationStatus: 'planned',
  },
  {
    id: 'conversation-archives',
    portContracts: ['ChatArchiveRepository'],
    launchPolicy: 'required',
    implementationStatus: 'planned',
  },
  {
    id: 'heartbeat-task-authority',
    portContracts: ['HeartbeatTaskStore', 'HeartbeatTargetedTaskStore'],
    launchPolicy: 'required',
    implementationStatus: 'existing-v5',
  },
  {
    id: 'execution-host-conversation-lifecycle',
    portContracts: ['HostedConversationTurnLifecycleStore'],
    launchPolicy: 'required',
    implementationStatus: 'blocked-on-domain-port',
  },
  {
    id: 'result-artifacts',
    portContracts: ['ArtifactRepository'],
    launchPolicy: 'deferred',
    implementationStatus: 'unavailable',
  },
  {
    id: 'standalone-heartbeat-checkpoint',
    portContracts: ['HeartbeatCheckpointStore'],
    launchPolicy: 'deferred',
    implementationStatus: 'unavailable',
  },
  {
    id: 'agent-skill-activation',
    portContracts: ['AgentSkillActivationStorePort'],
    launchPolicy: 'not-planned',
    implementationStatus: 'unavailable',
  },
  {
    id: 'mcp-config',
    portContracts: ['McpConfigStorePort'],
    launchPolicy: 'not-planned',
    implementationStatus: 'unavailable',
  },
  {
    id: 'mcp-activation',
    portContracts: ['McpActivationStorePort'],
    launchPolicy: 'not-planned',
    implementationStatus: 'unavailable',
  },
  {
    id: 'mcp-discovery-catalog',
    portContracts: ['McpCatalogStorePort'],
    launchPolicy: 'not-planned',
    implementationStatus: 'unavailable',
  },
];

const POSTGRES_ADAPTER_STATUS_VALUES = {
  launchPolicy: new Set(['required', 'deferred', 'not-planned']),
  implementationStatus: new Set([
    'existing-v5',
    'planned',
    'blocked-on-domain-port',
    'unavailable',
  ]),
};

const DURABLE_STATE_STATUS_VALUES = {
  stateClass: new Set([
    'canonical',
    'continuity',
    'diagnostic',
    'coordination',
    'secret',
    'accounting',
    'audit',
  ]),
  backendClass: new Set([
    'remote-ready',
    'host-replaceable',
    'workspace-local',
    'machine-local',
    'process-local',
    'none',
    'embedded',
    'host-sink',
    'external',
  ]),
  contractStatus: new Set([
    'public-port',
    'public-data',
    'internal-port',
    'no-port',
    'proposed-port',
    'external',
  ]),
  officialAdapterStatus: new Set([
    'available',
    'selected-not-implemented',
    'not-selected',
    'not-applicable',
  ]),
};

export const DURABLE_STATE_SURFACE_REQUIREMENTS = [
  {
    id: 'conversation-sessions',
    stateClass: 'canonical',
    backendClass: 'remote-ready',
    contractStatus: 'public-port',
    officialAdapterStatus: 'selected-not-implemented',
    postgresDecisionId: 'conversation-sessions',
  },
  {
    id: 'conversation-archives',
    stateClass: 'canonical',
    backendClass: 'remote-ready',
    contractStatus: 'public-port',
    officialAdapterStatus: 'selected-not-implemented',
    postgresDecisionId: 'conversation-archives',
  },
  {
    id: 'result-artifacts',
    stateClass: 'canonical',
    backendClass: 'host-replaceable',
    contractStatus: 'public-port',
    officialAdapterStatus: 'not-selected',
    postgresDecisionId: 'result-artifacts',
  },
  {
    id: 'raw-turn-traces',
    stateClass: 'diagnostic',
    backendClass: 'workspace-local',
    contractStatus: 'public-data',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'memory-notes-maintenance',
    stateClass: 'canonical',
    backendClass: 'workspace-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'remembered-approvals',
    stateClass: 'canonical',
    backendClass: 'workspace-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'project-config',
    stateClass: 'canonical',
    backendClass: 'workspace-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'mcp-config',
    stateClass: 'canonical',
    backendClass: 'host-replaceable',
    contractStatus: 'internal-port',
    officialAdapterStatus: 'not-selected',
    postgresDecisionId: 'mcp-config',
  },
  {
    id: 'mcp-activation',
    stateClass: 'canonical',
    backendClass: 'host-replaceable',
    contractStatus: 'internal-port',
    officialAdapterStatus: 'not-selected',
    postgresDecisionId: 'mcp-activation',
  },
  {
    id: 'mcp-discovery-catalog',
    stateClass: 'continuity',
    backendClass: 'host-replaceable',
    contractStatus: 'internal-port',
    officialAdapterStatus: 'not-selected',
    postgresDecisionId: 'mcp-discovery-catalog',
  },
  {
    id: 'agent-skill-activation',
    stateClass: 'canonical',
    backendClass: 'host-replaceable',
    contractStatus: 'public-port',
    officialAdapterStatus: 'not-selected',
    postgresDecisionId: 'agent-skill-activation',
  },
  {
    id: 'custom-agent-definitions',
    stateClass: 'canonical',
    backendClass: 'workspace-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'heartbeat-task-authority',
    stateClass: 'canonical',
    backendClass: 'host-replaceable',
    contractStatus: 'public-port',
    officialAdapterStatus: 'available',
    postgresDecisionId: 'heartbeat-task-authority',
  },
  {
    id: 'standalone-heartbeat-checkpoint',
    stateClass: 'continuity',
    backendClass: 'host-replaceable',
    contractStatus: 'public-port',
    officialAdapterStatus: 'not-selected',
    postgresDecisionId: 'standalone-heartbeat-checkpoint',
  },
  {
    id: 'browser-settings-profiles',
    stateClass: 'secret',
    backendClass: 'machine-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'runtime-workspace-catalog',
    stateClass: 'continuity',
    backendClass: 'machine-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'daemon-registry',
    stateClass: 'continuity',
    backendClass: 'machine-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'provider-credentials',
    stateClass: 'secret',
    backendClass: 'machine-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'session-image-uploads',
    stateClass: 'canonical',
    backendClass: 'workspace-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'diagnostic-output',
    stateClass: 'diagnostic',
    backendClass: 'workspace-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'active-run-coordination',
    stateClass: 'coordination',
    backendClass: 'process-local',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'execution-host-conversation-lifecycle',
    stateClass: 'canonical',
    backendClass: 'none',
    contractStatus: 'proposed-port',
    officialAdapterStatus: 'selected-not-implemented',
    postgresDecisionId: 'execution-host-conversation-lifecycle',
  },
  {
    id: 'workspace-continuity-checkpoints',
    stateClass: 'continuity',
    backendClass: 'none',
    contractStatus: 'no-port',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'normalized-llm-usage',
    stateClass: 'accounting',
    backendClass: 'embedded',
    contractStatus: 'public-data',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'control-plane-audit-events',
    stateClass: 'audit',
    backendClass: 'host-sink',
    contractStatus: 'public-data',
    officialAdapterStatus: 'not-applicable',
  },
  {
    id: 'telemetry-events',
    stateClass: 'diagnostic',
    backendClass: 'host-sink',
    contractStatus: 'public-data',
    officialAdapterStatus: 'not-selected',
  },
  {
    id: 'product-canonical-truth',
    stateClass: 'canonical',
    backendClass: 'external',
    contractStatus: 'external',
    officialAdapterStatus: 'not-applicable',
  },
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
    2,
    'The durable-port inventory must use schema version 2.',
  );
  assert.equal(
    inventory.adapterPackage,
    '@heddleagent/postgres',
    'The durable-port inventory must name the concrete adapter package.',
  );
  assert.equal(
    inventory.productionMigrationExecutionOwner,
    'adopter',
    'Production migration execution must remain adopter-owned.',
  );
  assert.ok(
    Array.isArray(inventory.ports),
    'The durable-port inventory must contain a ports array.',
  );

  const expectedRequirements = new Map(
    POSTGRES_ADAPTER_REQUIREMENTS.map((requirement) => [
      requirement.id,
      requirement,
    ]),
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
    'The durable-port inventory must contain exactly the reviewed Heddle durable ports.',
  );

  for (const port of inventory.ports) {
    const expected = expectedRequirements.get(port.id);

    for (const field of ['launchPolicy', 'implementationStatus']) {
      assert.ok(
        POSTGRES_ADAPTER_STATUS_VALUES[field].has(port[field]),
        `${port.id}.${field} must use an approved status.`,
      );
      assert.equal(
        port[field],
        expected[field],
        `${port.id}.${field} must retain its reviewed status.`,
      );
    }

    assertUniqueNonEmptyStringArray(
      port.portContracts,
      `${port.id}.portContracts`,
    );
    for (const contract of port.portContracts) {
      assert.doesNotMatch(
        contract,
        /postgres|sql|drizzle/i,
        `${port.id}.portContracts must remain technology-neutral domain contracts.`,
      );
    }
    assert.deepEqual(
      port.portContracts,
      expected.portContracts,
      `${port.id}.portContracts must retain the reviewed domain contracts.`,
    );

    for (const field of [
      'portOwnerPackage',
      'currentEvidence',
      'publicSurface',
      'currentAdapter',
      'consistency',
      'implementationGate',
    ]) {
      assertNonEmptyString(port[field], `${port.id}.${field}`);
    }
    assert.notEqual(
      port.portOwnerPackage,
      inventory.adapterPackage,
      `${port.id}.portOwnerPackage must identify the domain package rather than the PostgreSQL adapter package.`,
    );

    if (port.launchPolicy === 'required') {
      assertNonEmptyString(port.conformance, `${port.id}.conformance`);
      assertNonEmptyString(
        port.plannedAdapterEntryPoint,
        `${port.id}.plannedAdapterEntryPoint`,
      );
      assert.ok(
        port.plannedAdapterEntryPoint.startsWith(
          `${inventory.adapterPackage}/`,
        ),
        `${port.id}.plannedAdapterEntryPoint must start with ${inventory.adapterPackage}/.`,
      );
      assert.notEqual(
        port.implementationStatus,
        'unavailable',
        `${port.id} is launch-required and cannot claim that its adapter is unavailable.`,
      );
      assert.equal(
        port.exclusionRationale,
        undefined,
        `${port.id} is launch-required and cannot also claim exclusion.`,
      );
      continue;
    }

    assert.equal(
      port.implementationStatus,
      'unavailable',
      `${port.id} is not selected for launch and must not imply an available official adapter.`,
    );
    assertNonEmptyString(
      port.exclusionRationale,
      `${port.id}.exclusionRationale`,
    );
    assert.equal(
      port.plannedAdapterEntryPoint,
      undefined,
      `${port.id} is not selected for launch and must not claim a planned adapter entrypoint.`,
    );
  }
}

export function assertDurableStateSurfaceInventory(
  inventory,
  postgresInventory,
) {
  assert.equal(
    inventory.schemaVersion,
    1,
    'The durable-state surface tracker must use schema version 1.',
  );
  assert.ok(
    Array.isArray(inventory.surfaces),
    'The durable-state surface tracker must contain a surfaces array.',
  );
  assert.ok(
    Array.isArray(postgresInventory.ports),
    'The PostgreSQL durable-port inventory must contain a ports array.',
  );

  const expectedRequirements = new Map(
    DURABLE_STATE_SURFACE_REQUIREMENTS.map((requirement) => [
      requirement.id,
      requirement,
    ]),
  );
  const actualIds = inventory.surfaces.map(({ id }) => id);
  assert.equal(
    new Set(actualIds).size,
    actualIds.length,
    'The durable-state surface tracker must not contain duplicate IDs.',
  );
  assert.deepEqual(
    [...actualIds].sort(),
    [...expectedRequirements.keys()].sort(),
    'The durable-state surface tracker must contain exactly the reviewed platform state surfaces.',
  );

  const postgresDecisionIds = new Set(
    postgresInventory.ports.map(({ id }) => id),
  );
  const mappedPostgresDecisionIds = new Set();

  for (const surface of inventory.surfaces) {
    const expected = expectedRequirements.get(surface.id);

    for (const field of [
      'stateClass',
      'backendClass',
      'contractStatus',
      'officialAdapterStatus',
    ]) {
      assert.ok(
        DURABLE_STATE_STATUS_VALUES[field].has(surface[field]),
        `${surface.id}.${field} must use an approved status.`,
      );
      assert.equal(
        surface[field],
        expected[field],
        `${surface.id}.${field} must retain its reviewed status.`,
      );
    }

    for (const field of [
      'surface',
      'ownerDomain',
      'currentEvidence',
      'nextGate',
    ]) {
      assertNonEmptyString(surface[field], `${surface.id}.${field}`);
    }

    assert.equal(
      surface.postgresDecisionId,
      expected.postgresDecisionId,
      `${surface.id}.postgresDecisionId must retain its reviewed PostgreSQL decision mapping.`,
    );

    if (surface.postgresDecisionId !== undefined) {
      assert.ok(
        postgresDecisionIds.has(surface.postgresDecisionId),
        `${surface.id}.postgresDecisionId must reference a current PostgreSQL durable-port decision.`,
      );
      mappedPostgresDecisionIds.add(surface.postgresDecisionId);
    }
  }

  assert.deepEqual(
    [...mappedPostgresDecisionIds].sort(),
    [...postgresDecisionIds].sort(),
    'Every PostgreSQL durable-port decision must map to at least one canonical platform state surface.',
  );
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

  const postgresInventory = readJson(
    new URL(
      'packages/postgres/durable-port-support.json',
      repositoryUrl,
    ),
  );
  assertDurablePortInventory(postgresInventory);
  assertDurableStateSurfaceInventory(
    readJson(
      new URL(
        'docs/architecture/durable-state-surfaces.json',
        repositoryUrl,
      ),
    ),
    postgresInventory,
  );

  process.stdout.write(
    `Verified ${PACKAGE_DEFINITIONS.length} private @heddleagent package foundations, ${DURABLE_STATE_SURFACE_REQUIREMENTS.length} platform state surfaces, and ${POSTGRES_ADAPTER_REQUIREMENTS.length} PostgreSQL adapter decisions.\n`,
  );
}

function assertUniqueNonEmptyStringArray(value, field) {
  assert.ok(Array.isArray(value), `${field} must be an array.`);
  assert.ok(value.length > 0, `${field} must not be empty.`);
  assert.equal(
    new Set(value).size,
    value.length,
    `${field} must not contain duplicates.`,
  );
  value.forEach((item, index) =>
    assertNonEmptyString(item, `${field}[${index}]`),
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
