import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const packageJson = JSON.parse(
  readFileSync(new URL('../packages/runtime/package.json', import.meta.url), 'utf8'),
);
const releaseTag = `runtime-v${packageJson.version}`;
const result = spawnSync(
  'npm',
  ['view', `${packageJson.name}@${packageJson.version}`, 'version', '--json'],
  { encoding: 'utf8' },
);

let publicationNeeded;
if (result.status === 0) {
  const publishedVersion = JSON.parse(result.stdout);
  if (publishedVersion !== packageJson.version) {
    throw new Error(
      `Registry returned ${JSON.stringify(publishedVersion)} for ${packageJson.name}@${packageJson.version}.`,
    );
  }
  publicationNeeded = false;
} else if (`${result.stdout}\n${result.stderr}`.includes('E404')) {
  publicationNeeded = true;
} else {
  throw new Error(
    `Unable to determine ${packageJson.name}@${packageJson.version} release state:\n${result.stdout}\n${result.stderr}`,
  );
}

const outputs = {
  publication_needed: String(publicationNeeded),
  release_tag: releaseTag,
  version: packageJson.version,
};
const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  appendFileSync(
    githubOutput,
    `${Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
  );
}

process.stdout.write(
  `${packageJson.name}@${packageJson.version}: ${publicationNeeded ? 'publication required' : 'already published'}\n`,
);
