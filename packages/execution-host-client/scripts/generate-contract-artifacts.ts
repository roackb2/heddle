import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createContractArtifacts } from './contract-artifacts.js';

const specRoot = new URL('../spec/v1/', import.meta.url);
const checkOnly = process.argv.includes('--check');
const artifacts = createContractArtifacts();
const drift: string[] = [];

for (const [relativePath, expected] of artifacts) {
  const target = new URL(relativePath, specRoot);
  if (checkOnly) {
    const actual = await readFile(target, 'utf8').catch(() => undefined);
    if (actual !== expected) {
      drift.push(relativePath);
    }
    continue;
  }
  await writeFile(target, expected, 'utf8');
}

if (drift.length > 0) {
  throw new Error([
    'Published adopter contract artifacts are stale:',
    ...drift.map((path) => `- ${path}`),
    'Run yarn execution-host-client:contract:generate.',
  ].join('\n'));
}

if (!checkOnly) {
  console.log(
    `Generated ${artifacts.size} contract artifacts under ${fileURLToPath(specRoot)}.`,
  );
}
