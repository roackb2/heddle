import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rootPackage = readPackage(new URL('../package.json', import.meta.url));
const remotePackage = readPackage(
  new URL('../packages/heddle-remote/package.json', import.meta.url),
);

assert.equal(
  remotePackage.version,
  rootPackage.version,
  'Heddle and @roackb2/heddle-remote must be released at the same version.',
);
assert.deepEqual(
  remotePackage.dependencies,
  {
    '@standard-schema/spec': rootPackage.dependencies['@standard-schema/spec'],
    zod: rootPackage.dependencies.zod,
  },
  '@roackb2/heddle-remote must keep its explicit browser-safe dependency boundary.',
);
assert.equal(
  rootPackage.exports['./remote'],
  undefined,
  'The root package must not recreate the remote package as an install-heavy subpath.',
);
assert.equal(
  readFileSync(new URL('../packages/heddle-remote/LICENSE', import.meta.url), 'utf8'),
  readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'),
  'The remote package must ship the repository license without drift.',
);

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}
