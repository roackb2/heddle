import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIRECTORIES = new Map([
  ['root', new URL('../dist/', import.meta.url)],
  ['remote', new URL('../packages/heddle-remote/dist/', import.meta.url)],
]);

const requestedTargets = process.argv.slice(2);
const targets = requestedTargets.length > 0
  ? requestedTargets
  : [...OUTPUT_DIRECTORIES.keys()];

for (const target of targets) {
  const directory = OUTPUT_DIRECTORIES.get(target);
  if (!directory) {
    throw new Error(
      `Unknown build output "${target}". Expected one of: ${[...OUTPUT_DIRECTORIES.keys()].join(', ')}.`,
    );
  }
  rmSync(fileURLToPath(directory), { recursive: true, force: true });
}
