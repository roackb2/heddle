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
      'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
      zod: rootPackage.dependencies.zod,
    });
    expect(remotePackage.exports['./http-sse']).toEqual({
      types: './dist/http-sse/index.d.ts',
      import: './dist/http-sse/index.js',
    });
    expect(rootPackage.exports['./hosted/http-sse']).toEqual({
      types: './dist/src/hosted/http-sse.d.ts',
      import: './dist/src/hosted/http-sse.js',
    });
  });
});

function readPackage(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
