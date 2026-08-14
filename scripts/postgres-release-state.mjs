import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  NPM_REGISTRY,
  parseRegistryArtifactResult,
} from './execution-host-client-release-state.mjs';
import {
  POSTGRES_PACKAGE_NAME,
  POSTGRES_PACKAGE_VERSION,
} from './verify-postgres-package.mjs';

const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));

export function createPostgresReleaseMetadata(packageJson) {
  assert.equal(packageJson.name, POSTGRES_PACKAGE_NAME);
  assert.equal(packageJson.version, POSTGRES_PACKAGE_VERSION);
  assert.equal(packageJson.publishConfig?.registry, NPM_REGISTRY);
  assert.equal(packageJson.publishConfig?.access, 'public');
  assert.equal(
    packageJson.publishConfig?.tag,
    'latest',
    'PostgreSQL adapter releases must use the stable latest channel.',
  );
  return {
    name: packageJson.name,
    version: packageJson.version,
    releaseTag: `postgres-v${packageJson.version}`,
    releaseNote: `docs/releases/postgres-v${packageJson.version}.md`,
    releaseTitle: `Heddle PostgreSQL Adapters v${packageJson.version}`,
  };
}

export function selectPostgresRelease({
  artifact,
  releaseTagPointsAtHead,
}) {
  return {
    publicationNeeded: artifact.kind === 'missing',
    releaseSelected: artifact.kind === 'missing' || releaseTagPointsAtHead,
  };
}

export function readPostgresReleaseState(
  repositoryPath = repositoryDirectory,
) {
  const packageJson = JSON.parse(
    readFileSync(
      resolve(repositoryPath, 'packages/postgres/package.json'),
      'utf8',
    ),
  );
  const metadata = createPostgresReleaseMetadata(packageJson);
  assert.equal(
    existsSync(resolve(repositoryPath, metadata.releaseNote)),
    true,
    `Release ${metadata.version} requires ${metadata.releaseNote}.`,
  );

  const target = `${metadata.name}@${metadata.version}`;
  const npmCacheDirectory = mkdtempSync(
    join(tmpdir(), 'heddle-postgres-release-state-'),
  );
  let artifact;
  try {
    artifact = parseRegistryArtifactResult(
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
        repositoryPath,
        { ...process.env, npm_config_cache: npmCacheDirectory },
      ),
      target,
    );
  } finally {
    rmSync(npmCacheDirectory, { recursive: true, force: true });
  }

  const releaseTagPointsAtHead = run(
    'git',
    ['tag', '--points-at', 'HEAD'],
    repositoryPath,
  ).stdout.split('\n').includes(metadata.releaseTag);
  const state = {
    ...metadata,
    artifact,
    ...selectPostgresRelease({ artifact, releaseTagPointsAtHead }),
  };
  if (state.publicationNeeded && process.env.GITHUB_ACTIONS === 'true') {
    assert.equal(process.env.GITHUB_REPOSITORY, 'roackb2/heddle');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    assert.equal(
      process.env.GITHUB_SHA,
      run('git', ['rev-parse', 'HEAD'], repositoryPath).stdout.trim(),
      'Automatic publication must use the exact checked-out main commit.',
    );
    assert.ok(
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
      'Automatic publication requires id-token: write for npm trusted publishing.',
    );
  }
  return state;
}

function writeGitHubOutputs(state) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    [
      `version=${state.version}`,
      `release_tag=${state.releaseTag}`,
      `release_note=${state.releaseNote}`,
      `publication_needed=${state.publicationNeeded}`,
      `release_selected=${state.releaseSelected}`,
      '',
    ].join('\n'),
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

function runResult(command, args, cwd, environment = process.env) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  assert.deepEqual(
    process.argv.slice(2),
    [],
    'The release-state command accepts no arguments.',
  );
  const state = readPostgresReleaseState();
  writeGitHubOutputs(state);
  process.stdout.write(
    `${state.name}@${state.version}: ${state.publicationNeeded ? 'publication required' : 'immutable version already published'}; ${state.releaseSelected ? 'release selected' : 'ordinary merge'}\n`,
  );
}
