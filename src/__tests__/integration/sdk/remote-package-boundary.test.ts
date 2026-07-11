import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootPackage = readPackage('package.json');
const remotePackage = readPackage('packages/heddle-remote/package.json');

describe('@roackb2/heddle-remote package boundary', () => {
  it('is versioned with Heddle without remaining a root package subpath', () => {
    expect(remotePackage.version).toBe(rootPackage.version);
    expect(rootPackage.exports['./remote']).toBeUndefined();
  });

  it('installs only its browser-safe protocol dependencies', () => {
    expect(remotePackage.dependencies).toEqual({
      '@standard-schema/spec': rootPackage.dependencies['@standard-schema/spec'],
      zod: rootPackage.dependencies.zod,
    });
  });
});

function readPackage(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
