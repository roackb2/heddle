import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootPackage = readPackage('package.json');
const adopterPackage = readPackage('packages/heddle-adopter/package.json');

describe('@roackb2/heddle-adopter package boundary', () => {
  it('is versioned with Heddle without becoming a root package subpath', () => {
    expect(adopterPackage.version).toBe(rootPackage.version);
    expect(rootPackage.exports['./adopter']).toBeUndefined();
  });

  it('keeps only the contract, JOSE, and SSE dependencies', () => {
    expect(adopterPackage.dependencies).toEqual({
      'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
      jose: rootPackage.devDependencies.jose,
      zod: rootPackage.dependencies.zod,
    });
    expect(adopterPackage.dependencies['@roackb2/heddle']).toBeUndefined();
    expect(adopterPackage.dependencies['@aws-sdk/client-bedrock-agentcore'])
      .toBeUndefined();
    expect(adopterPackage.dependencies['@modelcontextprotocol/sdk'])
      .toBeUndefined();
  });

  it('publishes only its intentional subpaths', () => {
    expect(Object.keys(adopterPackage.exports)).toEqual([
      '.',
      './contracts',
      './authority',
      './mcp',
      './http-sse',
      './testing',
      './package.json',
    ]);
  });
});

function readPackage(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
