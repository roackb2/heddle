import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_PACKAGE_NAME,
  verifyCliPackage,
} from './verify-cli-package.mjs';
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

export function verifyPackageFamily(
  repositoryUrl = new URL('../', import.meta.url),
) {
  const rootPackage = readJson(new URL('package.json', repositoryUrl));
  assert.equal(
    rootPackage.workspaces,
    undefined,
    'The package family must not introduce a workspace/build-tool migration.',
  );

  verifyCliPackage(repositoryUrl, { writeOutput: false });
  verifyExecutionHostClientPackage(repositoryUrl, { writeOutput: false });
  verifyPostgresPackage(repositoryUrl, { writeOutput: false });
  verifyRunClientPackage(repositoryUrl, { writeOutput: false });
  verifyRuntimePackage(repositoryUrl, { writeOutput: false });

  const expectedPackageNames = [
    CLI_PACKAGE_NAME,
    EXECUTION_HOST_CLIENT_NAME,
    POSTGRES_PACKAGE_NAME,
    RUN_CLIENT_PACKAGE_NAME,
    RUNTIME_PACKAGE_NAME,
  ].sort();
  const actualPackageNames = readdirSync(
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
    actualPackageNames,
    expectedPackageNames,
    'The @heddleagent scope must contain exactly the five activated packages.',
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
    `Verified five activated @heddleagent packages and ${legacyPackages.size} local v5 package identities.\n`,
  );
}

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyPackageFamily();
}
