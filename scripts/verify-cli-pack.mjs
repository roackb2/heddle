import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseNpmPackResult } from './execution-host-client-pack-result.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const verificationRoot = mkdtempSync(join(tmpdir(), 'heddle-cli-pack-'));
const npmCache = join(verificationRoot, 'npm-cache');
const consumerDirectory = join(verificationRoot, 'consumer');

try {
  const runtimePack = pack('packages/runtime', '@heddleagent/runtime');
  const cliPack = pack('packages/cli', '@heddleagent/cli');
  const cliPaths = new Set(cliPack.files.map(({ path }) => path));

  assert.equal(cliPack.version, '6.0.0');
  for (const path of [
    'dist/src/cli-v2/main.js',
    'dist/src/client-shared/api/proxy.js',
    'dist/src/web-v2/index.html',
  ]) {
    assert.equal(cliPaths.has(path), true, `Packed CLI is missing ${path}.`);
  }
  assert.equal(
    [...cliPaths].some((path) => path.startsWith('dist/src/web-v2/assets/')),
    true,
    'Packed CLI is missing built browser assets.',
  );
  for (const prefix of [
    'dist/src/core/',
    'dist/src/server/',
    'dist/src/sdk/',
    'dist/src/web-v2/node_modules/',
  ]) {
    assert.equal(
      [...cliPaths].some((path) => path.startsWith(prefix)),
      false,
      `Packed CLI must not contain ${prefix}.`,
    );
  }

  mkdirSync(consumerDirectory, { recursive: true });
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--omit=optional',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--cache',
      npmCache,
      join(verificationRoot, runtimePack.filename),
      join(verificationRoot, cliPack.filename),
    ],
    consumerDirectory,
  );

  const installedMain = join(
    consumerDirectory,
    'node_modules/@heddleagent/cli/dist/src/cli-v2/main.js',
  );
  assert.equal(existsSync(installedMain), true, 'Installed CLI entrypoint is missing.');
  assert.equal(
    readFileSync(installedMain, 'utf8').startsWith('#!/usr/bin/env node'),
    true,
    'Installed CLI entrypoint must retain its Node shebang.',
  );
  const binary = join(consumerDirectory, 'node_modules/.bin/heddle');
  assert.equal(existsSync(binary), true, 'npm did not install the heddle executable.');
  assert.equal(run(binary, ['--version'], consumerDirectory).stdout.trim(), '6.0.0');
  assert.match(run(binary, ['daemon', '--help'], consumerDirectory).stdout, /browser control plane/);

  process.stdout.write(
    'Verified packed @heddleagent/cli@6.0.0 with its runtime dependency, executable, and browser assets.\n',
  );
} finally {
  rmSync(verificationRoot, { recursive: true, force: true });
}

function pack(directory, packageName) {
  const result = run(
    'npm',
    [
      'pack',
      join(repositoryRoot, directory),
      '--json',
      '--pack-destination',
      verificationRoot,
      '--cache',
      npmCache,
    ],
    repositoryRoot,
  );
  return parseNpmPackResult(result.stdout, packageName);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}
