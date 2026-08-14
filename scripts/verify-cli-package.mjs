import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_PACKAGE_NAME = '@heddleagent/cli';
export const CLI_PACKAGE_VERSION = '6.0.0';

const dependencies = (rootPackage) => ({
  '@heddleagent/run-client': '^6.0.0',
  '@heddleagent/runtime': '^6.1.0',
  '@trpc/client': rootPackage.dependencies['@trpc/client'],
  '@trpc/server': rootPackage.dependencies['@trpc/server'],
  chalk: rootPackage.dependencies.chalk,
  commander: rootPackage.dependencies.commander,
  dayjs: rootPackage.dependencies.dayjs,
  debounce: rootPackage.dependencies.debounce,
  eventsource: rootPackage.dependencies.eventsource,
  ink: rootPackage.dependencies.ink,
  lodash: rootPackage.dependencies.lodash,
  marked: rootPackage.dependencies.marked,
  'marked-terminal': rootPackage.dependencies['marked-terminal'],
  react: rootPackage.dependencies.react,
  'string-width': rootPackage.dependencies['string-width'],
  'strip-ansi': rootPackage.dependencies['strip-ansi'],
});

export function createCliManifest(rootPackage) {
  return {
    name: CLI_PACKAGE_NAME,
    version: CLI_PACKAGE_VERSION,
    description:
      'Heddle coding-agent CLI, daemon, and local browser control-plane product',
    author: 'Jay / Fienna Liang <roackb2@gmail.com>',
    license: 'MIT',
    type: 'module',
    publishConfig: {
      access: 'public',
      tag: 'latest',
      registry: 'https://registry.npmjs.org/',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/roackb2/heddle.git',
      directory: 'packages/cli',
    },
    homepage: 'https://heddleagent.com',
    bugs: {
      url: 'https://github.com/roackb2/heddle/issues',
    },
    engines: {
      node: rootPackage.engines.node,
    },
    bin: {
      heddle: './dist/src/cli-v2/main.js',
    },
    files: ['dist', 'README.md', 'LICENSE'],
    keywords: [
      'agent',
      'ai-agent',
      'coding-agent',
      'cli',
      'developer-tools',
    ],
    dependencies: dependencies(rootPackage),
  };
}

export function assertCliManifest(packageJson, rootPackage) {
  assert.deepEqual(
    packageJson,
    createCliManifest(rootPackage),
    `${CLI_PACKAGE_NAME} must remain the exact installable coding-agent product.`,
  );
}

export function verifyCliPackage(
  repositoryUrl = new URL('../', import.meta.url),
  { writeOutput = true } = {},
) {
  const rootPackage = readPackage(new URL('package.json', repositoryUrl));
  const packageDirectory = new URL('packages/cli/', repositoryUrl);
  const packageJson = readPackage(new URL('package.json', packageDirectory));

  assertCliManifest(packageJson, rootPackage);
  assert.equal(
    readFileSync(new URL('LICENSE', packageDirectory), 'utf8'),
    readFileSync(new URL('LICENSE', repositoryUrl), 'utf8'),
    'The CLI package must ship the repository license without drift.',
  );
  for (const entrypoint of [
    'src/cli-v2/main.ts',
    'src/cli-runtime.ts',
    'src/web-v2/vite.config.ts',
  ]) {
    assert.equal(
      existsSync(new URL(entrypoint, repositoryUrl)),
      true,
      `The canonical CLI source entrypoint ${entrypoint} must exist.`,
    );
  }
  assert.equal(
    existsSync(new URL('packages/cli/src/', repositoryUrl)),
    false,
    'The CLI package must compile canonical product sources instead of duplicating them.',
  );

  if (writeOutput) {
    process.stdout.write(
      `Verified ${CLI_PACKAGE_NAME}@${CLI_PACKAGE_VERSION} as the stable Heddle coding-agent product.\n`,
    );
  }
}

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyCliPackage();
}
