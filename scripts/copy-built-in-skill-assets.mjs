import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const assets = [
  'src/core/skills/browser-automation.skill.yaml',
];
const outputDirectory = process.argv[2] ?? 'dist';

for (const asset of assets) {
  const target = join(outputDirectory, asset);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(asset, target);
}
