import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const assets = [
  'src/core/skills/browser-automation.skill.yaml',
];

for (const asset of assets) {
  const target = join('dist', asset);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(asset, target);
}
