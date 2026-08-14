import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootPackage = readPackage('package.json');
const runClientPackage = readPackage('packages/run-client/package.json');

describe('@heddleagent/run-client package boundary', () => {
  it('is independently versioned without becoming a root package subpath', () => {
    expect(runClientPackage.version).toBe('6.0.0');
    expect(rootPackage.exports['./remote']).toBeUndefined();
  });

  it('installs only its browser-safe protocol dependencies', () => {
    expect(runClientPackage.dependencies).toEqual({
      '@standard-schema/spec': rootPackage.dependencies['@standard-schema/spec'],
      'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
      zod: rootPackage.dependencies.zod,
    });
    expect(runClientPackage.exports['./http-sse']).toEqual({
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
