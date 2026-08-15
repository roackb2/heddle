#!/usr/bin/env node
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const BIN_PATHS = new Map([
  ['root', 'dist/src/cli-v2/main.js'],
  ['cli', 'packages/cli/dist/src/cli-v2/main.js'],
]);

const requestedTargets = process.argv.slice(2);
const targets = requestedTargets.length > 0
  ? requestedTargets
  : [...BIN_PATHS.keys()];

for (const target of targets) {
  const binPath = BIN_PATHS.get(target);
  if (!binPath) {
    throw new Error(
      `Unknown binary target "${target}". Expected one of: ${[...BIN_PATHS.keys()].join(', ')}.`,
    );
  }
  const absolutePath = resolve(repoRoot, binPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing built bin entrypoint: ${binPath}`);
  }
  chmodSync(absolutePath, 0o755);
}
