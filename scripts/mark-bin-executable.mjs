#!/usr/bin/env node
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const binPaths = [
  'dist/src/cli-v2/main.js',
];

for (const binPath of binPaths) {
  const absolutePath = resolve(repoRoot, binPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing built bin entrypoint: ${binPath}`);
  }
  chmodSync(absolutePath, 0o755);
}
