import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rootPackage = readPackage(new URL('../package.json', import.meta.url));
const adopterPackage = readPackage(
  new URL('../packages/heddle-adopter/package.json', import.meta.url),
);

assert.equal(
  adopterPackage.version,
  rootPackage.version,
  'Heddle and @roackb2/heddle-adopter must be released at the same version.',
);
assert.equal(
  adopterPackage.engines.node,
  rootPackage.engines.node,
  '@roackb2/heddle-adopter must keep the supported Node baseline in sync.',
);
assert.deepEqual(
  adopterPackage.dependencies,
  {
    '@modelcontextprotocol/sdk': rootPackage.dependencies['@modelcontextprotocol/sdk'],
    'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
    jose: rootPackage.devDependencies.jose,
    zod: rootPackage.dependencies.zod,
  },
  '@roackb2/heddle-adopter must keep its explicit backend dependency boundary.',
);
assert.deepEqual(
  Object.keys(adopterPackage.exports),
  [
    '.',
    './contracts',
    './authority',
    './conversation',
    './mcp',
    './mcp/node',
    './http-sse',
    './testing',
    './node',
    './spec/v1/openapi.json',
    './spec/v1/schema-bundle.json',
    './spec/v1/fixtures/*',
    './package.json',
  ],
  '@roackb2/heddle-adopter public subpaths must stay deliberate.',
);
assert.equal(
  rootPackage.exports['./adopter'],
  undefined,
  'The root package must not recreate the adopter SDK as an install-heavy subpath.',
);
assert.deepEqual(
  adopterPackage.files,
  ['dist', 'spec', 'README.md', 'LICENSE'],
  '@roackb2/heddle-adopter must publish its language-neutral contract artifacts.',
);
assert.equal(
  readFileSync(new URL('../packages/heddle-adopter/LICENSE', import.meta.url), 'utf8'),
  readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'),
  'The adopter package must ship the repository license without drift.',
);

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}
