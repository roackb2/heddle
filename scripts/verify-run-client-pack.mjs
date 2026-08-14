import assert from 'node:assert/strict';
import {
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

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const packageDirectory = join(repositoryRoot, 'packages/run-client');
const packageJson = JSON.parse(
  readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
);
const verificationRoot = mkdtempSync(join(tmpdir(), 'heddle-run-client-pack-'));
const npmCache = join(verificationRoot, 'npm-cache');
const consumerDirectory = join(verificationRoot, 'consumer');

try {
  const packed = run('npm', [
    'pack',
    packageDirectory,
    '--json',
    '--pack-destination',
    verificationRoot,
    '--cache',
    npmCache,
  ], repositoryRoot);
  const packResult = JSON.parse(packed.stdout)[0];

  assert.equal(packResult.name, '@heddleagent/run-client');
  assert.equal(packResult.version, '6.0.0');
  assert.ok(packResult.files.some(({ path }) => path === 'dist/index.js'));
  assert.ok(
    packResult.files.some(({ path }) => path === 'dist/http-sse/index.js'),
  );

  mkdirSync(consumerDirectory, { recursive: true });
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--cache',
      npmCache,
      join(verificationRoot, packResult.filename),
    ],
    consumerDirectory,
  );
  writeFileSync(
    join(consumerDirectory, 'smoke.mjs'),
    [
      "import assert from 'node:assert/strict';",
      "import { ConversationRunConsumerService, ConversationRunProtocolCodec } from '@heddleagent/run-client';",
      "import { ConversationRunHttpSseClient } from '@heddleagent/run-client/http-sse';",
      'assert.equal(typeof ConversationRunConsumerService, \'function\');',
      'assert.equal(typeof ConversationRunProtocolCodec, \'function\');',
      'assert.equal(typeof ConversationRunHttpSseClient, \'function\');',
      '',
    ].join('\n'),
  );
  run('node', ['smoke.mjs'], consumerDirectory);

  process.stdout.write(
    `Verified packed ${packageJson.name}@${packageJson.version} in a fresh ESM consumer.\n`,
  );
} finally {
  rmSync(verificationRoot, { recursive: true, force: true });
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
