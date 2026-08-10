import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rootPackage = readPackage(new URL('../package.json', import.meta.url));
const postgresPackage = readPackage(
  new URL('../packages/heddle-postgres/package.json', import.meta.url),
);

assert.equal(
  postgresPackage.version,
  rootPackage.version,
  'Heddle and @roackb2/heddle-postgres must be released at the same version.',
);
assert.equal(
  postgresPackage.engines.node,
  rootPackage.engines.node,
  '@roackb2/heddle-postgres must keep the supported Node baseline in sync.',
);
assert.deepEqual(
  postgresPackage.dependencies,
  {
    dayjs: rootPackage.dependencies.dayjs,
  },
  '@roackb2/heddle-postgres must keep its explicit persistence dependency boundary.',
);
assert.equal(
  postgresPackage.peerDependencies['@roackb2/heddle'],
  '>=5.12.0 <6',
  '@roackb2/heddle-postgres must declare its minimum compatible Heddle contract.',
);
assert.equal(
  postgresPackage.peerDependencies['drizzle-orm'],
  `>=${rootPackage.devDependencies['drizzle-orm']} <1`,
  '@roackb2/heddle-postgres must share one compatible Drizzle runtime with its host.',
);
assert.deepEqual(
  Object.keys(postgresPackage.exports),
  ['.', './schema', './package.json'],
  '@roackb2/heddle-postgres public subpaths must stay deliberate.',
);
assert.equal(
  rootPackage.exports['./postgres'],
  undefined,
  'The root package must not make PostgreSQL a core Heddle dependency.',
);
assert.equal(
  readFileSync(new URL('../packages/heddle-postgres/LICENSE', import.meta.url), 'utf8'),
  readFileSync(new URL('../LICENSE', import.meta.url), 'utf8'),
  'The PostgreSQL package must ship the repository license without drift.',
);
readFileSync(
  new URL('../packages/heddle-postgres/migrations/0000_heartbeat_authority.sql', import.meta.url),
  'utf8',
);

function readPackage(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}
