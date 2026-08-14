import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXECUTION_HOST_CLIENT_NAME,
  verifyExecutionHostClientPackage,
} from './verify-execution-host-client-package.mjs';
import {
  POSTGRES_PACKAGE_NAME,
  verifyPostgresPackage,
} from './verify-postgres-package.mjs';
import {
  RUN_CLIENT_PACKAGE_NAME,
  verifyRunClientPackage,
} from './verify-run-client-package.mjs';
import {
  RUNTIME_PACKAGE_NAME,
  verifyRuntimePackage,
} from './verify-runtime-package.mjs';

const AUTHOR = 'Jay / Fienna Liang <roackb2@gmail.com>';
const REPOSITORY_URL = 'git+https://github.com/roackb2/heddle.git';
const HOMEPAGE = 'https://heddleagent.com';
const BUGS_URL = 'https://github.com/roackb2/heddle/issues';
const FOUNDATION_STATUS =
  'Status: **private package foundation; not published or installable**';

export const PACKAGE_DEFINITIONS = [
  {
    directory: 'cli',
    name: '@heddleagent/cli',
    description:
      'Heddle coding-agent CLI, daemon, and local browser control-plane product',
    node: true,
    files: ['LICENSE', 'README.md', 'package.json'],
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

  verifyExecutionHostClientPackage(repositoryUrl, { writeOutput: false });
  verifyPostgresPackage(repositoryUrl, { writeOutput: false });
  verifyRunClientPackage(repositoryUrl, { writeOutput: false });
  verifyRuntimePackage(repositoryUrl, { writeOutput: false });

  const expectedPackageNames = PACKAGE_DEFINITIONS
    .map(({ name }) => name)
    .concat(
      EXECUTION_HOST_CLIENT_NAME,
      POSTGRES_PACKAGE_NAME,
      RUN_CLIENT_PACKAGE_NAME,
      RUNTIME_PACKAGE_NAME,
    )
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
    expectedPackageNames,
    'The @heddleagent scope must contain exactly one private foundation and four activated packages.',
  );

  const legacyPackages = new Map([
    [new URL('package.json', repositoryUrl), '@roackb2/heddle'],
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

  process.stdout.write(
    `Verified ${PACKAGE_DEFINITIONS.length} private @heddleagent package foundation, four activated packages, and ${legacyPackages.size} local v5 package identities.\n`,
  );
}

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyPackageFamily();
}
