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
import { parseNpmPackResult } from './execution-host-client-pack-result.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const packageDirectory = join(repositoryRoot, 'packages/runtime');
const packageJson = JSON.parse(
  readFileSync(join(packageDirectory, 'package.json'), 'utf8'),
);
const verificationRoot = mkdtempSync(join(tmpdir(), 'heddle-runtime-pack-'));
const npmCache = join(verificationRoot, 'npm-cache');
const consumerDirectory = join(verificationRoot, 'consumer');

const requiredFiles = [
  'dist/src/index.js',
  'dist/src/index.d.ts',
  'dist/src/advanced.js',
  'dist/src/advanced.d.ts',
  'dist/src/cli-runtime.js',
  'dist/src/cli-runtime.d.ts',
  'dist/src/hosted.js',
  'dist/src/hosted.d.ts',
  'dist/src/hosted/http-sse.js',
  'dist/src/hosted/http-sse.d.ts',
  'dist/src/heartbeat-testing.js',
  'dist/src/heartbeat-testing.d.ts',
  'dist/src/core/skills/browser-automation.skill.yaml',
];
const forbiddenPrefixes = [
  'dist/src/__tests__/',
  'dist/src/cli-v2/',
  'dist/src/web-v2/',
  'dist/examples/',
];

try {
  const packed = run(
    'npm',
    [
      'pack',
      packageDirectory,
      '--json',
      '--pack-destination',
      verificationRoot,
      '--cache',
      npmCache,
    ],
    repositoryRoot,
  );
  const packResult = parseNpmPackResult(
    packed.stdout,
    '@heddleagent/runtime',
  );
  const packedPaths = new Set(packResult.files.map(({ path }) => path));

  assert.equal(packResult.name, '@heddleagent/runtime');
  assert.equal(packResult.version, '6.1.0');
  for (const path of requiredFiles) {
    assert.equal(packedPaths.has(path), true, `Packed runtime is missing ${path}.`);
  }
  for (const prefix of forbiddenPrefixes) {
    assert.equal(
      [...packedPaths].some((path) => path.startsWith(prefix)),
      false,
      `Packed runtime must not contain ${prefix}.`,
    );
  }

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
      '--omit=optional',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
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
      "import { ConversationAgentService, createConversationEngine } from '@heddleagent/runtime';",
      "import { ConversationRunService } from '@heddleagent/runtime/runs';",
      "import { streamConversationRunSse } from '@heddleagent/runtime/runs/http-sse';",
      "import { OpenAiAdapter } from '@heddleagent/runtime/advanced';",
      "import { RuntimeHostResolver } from '@heddleagent/runtime/cli';",
      "import { HeartbeatTaskStoreConformance } from '@heddleagent/runtime/heartbeat/testing';",
      "assert.equal(typeof ConversationAgentService, 'function');",
      "assert.equal(typeof createConversationEngine, 'function');",
      "assert.equal(typeof ConversationRunService, 'function');",
      "assert.equal(typeof streamConversationRunSse, 'function');",
      "assert.equal(typeof OpenAiAdapter, 'function');",
      "assert.equal(typeof RuntimeHostResolver, 'function');",
      "assert.equal(typeof HeartbeatTaskStoreConformance, 'function');",
      '',
    ].join('\n'),
  );
  run('node', ['smoke.mjs'], consumerDirectory);

  writeFileSync(
    join(consumerDirectory, 'smoke.ts'),
    [
      "import { ConversationAgentService, type ConversationAgentOptions } from '@heddleagent/runtime';",
      "import { ConversationRunService, type ConversationRunServiceOptions } from '@heddleagent/runtime/runs';",
      "import { streamConversationRunSse, type ConversationRunSseEvent, type StreamConversationRunSseOptions } from '@heddleagent/runtime/runs/http-sse';",
      "import { OpenAiAdapter, type LlmAdapter } from '@heddleagent/runtime/advanced';",
      "import { RuntimeHostResolver, type ResolvedRuntimeHost } from '@heddleagent/runtime/cli';",
      "import { HeartbeatTaskStoreConformance, type HeartbeatTaskStoreConformanceHarness } from '@heddleagent/runtime/heartbeat/testing';",
      'void ConversationAgentService;',
      'void ConversationRunService;',
      'void streamConversationRunSse;',
      'void OpenAiAdapter;',
      'void RuntimeHostResolver;',
      'void HeartbeatTaskStoreConformance;',
      'type PublicTypes = ConversationAgentOptions | ConversationRunServiceOptions<{ sessionId: string }> | StreamConversationRunSseOptions<ConversationRunSseEvent> | LlmAdapter | ResolvedRuntimeHost | HeartbeatTaskStoreConformanceHarness;',
      'declare const value: PublicTypes;',
      'void value;',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ['smoke.ts'],
    }, null, 2)}\n`,
  );
  run(
    join(repositoryRoot, 'node_modules/.bin/tsc'),
    ['-p', 'tsconfig.json'],
    consumerDirectory,
  );

  process.stdout.write(
    `Verified packed ${packageJson.name}@${packageJson.version} in fresh JavaScript and TypeScript consumers.\n`,
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
