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
  EXECUTION_HOST_CLIENT_NAME,
  EXECUTION_HOST_CLIENT_VERSION,
} from './verify-execution-host-client-package.mjs';

export const NPM_REGISTRY = 'https://registry.npmjs.org/';
export const RELEASE_WORKFLOW = 'publish-packages.yml';
export const RELEASE_ENVIRONMENT = 'npm-release';

const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));

export function createExecutionHostClientReleaseMetadata(packageJson) {
  assert.equal(packageJson.name, EXECUTION_HOST_CLIENT_NAME);
  assert.equal(packageJson.version, EXECUTION_HOST_CLIENT_VERSION);
  assert.equal(packageJson.publishConfig?.registry, NPM_REGISTRY);
  assert.equal(packageJson.publishConfig?.access, 'public');
  assert.ok(
    ['latest', 'next'].includes(packageJson.publishConfig?.tag),
    'Execution Host client releases support only the latest and next npm channels.',
  );

  const prerelease = packageJson.version.includes('-');
  assert.equal(
    packageJson.publishConfig.tag,
    prerelease ? 'next' : 'latest',
    'Prereleases must use next and stable releases must use latest.',
  );

  return {
    name: packageJson.name,
    version: packageJson.version,
    publishTag: packageJson.publishConfig.tag,
    prerelease,
    releaseTag: `execution-host-client-v${packageJson.version}`,
    releaseNote:
      `docs/releases/execution-host-client-v${packageJson.version}.md`,
    releaseTitle: `Execution Host Client v${packageJson.version}`,
  };
}

export function parseRegistryArtifactResult(result, target) {
  if (result.status === 0) {
    const artifact = JSON.parse(result.stdout);
    assert.equal(
      typeof artifact.version,
      'string',
      `Registry metadata for ${target} is missing its version.`,
    );
    assert.equal(
      typeof artifact['dist.integrity'],
      'string',
      `Registry metadata for ${target} is missing its integrity.`,
    );
    return {
      kind: 'published',
      version: artifact.version,
      integrity: artifact['dist.integrity'],
    };
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assert.match(
    output,
    /E404|404 Not Found/,
    `Registry lookup for ${target} failed for a reason other than an absent immutable version.`,
  );
  return { kind: 'missing' };
}

export function assertRegistryArtifactMatches(
  artifact,
  { version, integrity },
) {
  assert.equal(
    artifact.kind,
    'published',
    `Expected ${version} to be publicly visible in the npm registry.`,
  );
  assert.equal(
    artifact.version,
    version,
    'The npm registry returned a different immutable version.',
  );
  assert.equal(
    artifact.integrity,
    integrity,
    'The npm registry artifact differs from the verified local tarball. Bump the package version before publishing changed bytes.',
  );
}

export function assertDistTagTransition({
  before,
  after,
  publishTag,
  version,
}) {
  assert.equal(
    after[publishTag],
    version,
    `The ${publishTag} dist-tag must point to ${version}.`,
  );

  for (const [tag, previousVersion] of Object.entries(before)) {
    if (tag === publishTag) continue;
    assert.equal(
      after[tag],
      previousVersion,
      `Publishing ${publishTag} must not move the existing ${tag} dist-tag.`,
    );
  }

  if (publishTag === 'next' && before.latest === undefined) {
    assert.ok(
      after.latest === undefined || after.latest === version,
      'A first prerelease may seed npm\'s required latest tag only to the same immutable version.',
    );
  }
}

export function selectExecutionHostClientRelease({
  artifact,
  releaseTagPointsAtHead,
}) {
  return {
    publicationNeeded: artifact.kind === 'missing',
    releaseSelected:
      artifact.kind === 'missing' || releaseTagPointsAtHead,
  };
}

export function readExecutionHostClientReleaseState(
  repositoryPath = repositoryDirectory,
) {
  const packageJson = JSON.parse(
    readFileSync(
      resolve(repositoryPath, 'packages/execution-host-client/package.json'),
      'utf8',
    ),
  );
  const metadata = createExecutionHostClientReleaseMetadata(packageJson);
  const releaseNotePath = resolve(repositoryPath, metadata.releaseNote);
  assert.equal(
    existsSync(releaseNotePath),
    true,
    `Release ${metadata.version} requires ${metadata.releaseNote}.`,
  );

  const target = `${metadata.name}@${metadata.version}`;
  const npmCacheDirectory = mkdtempSync(
    join(tmpdir(), 'heddle-execution-host-release-state-'),
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
    ...selectExecutionHostClientRelease({
      artifact,
      releaseTagPointsAtHead,
    }),
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
      `publish_tag=${state.publishTag}`,
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
  const state = readExecutionHostClientReleaseState();
  writeGitHubOutputs(state);
  process.stdout.write(
    `${state.name}@${state.version}: ${state.publicationNeeded ? 'publication required' : 'immutable version already published'}; ${state.releaseSelected ? 'release selected' : 'ordinary merge'}\n`,
  );
}
