import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootPackage = readPackage('package.json');
const adopterPackage = readPackage('packages/heddle-adopter/package.json');

describe('@roackb2/heddle-adopter package boundary', () => {
  it('is versioned with Heddle without becoming a root package subpath', () => {
    expect(adopterPackage.version).toBe(rootPackage.version);
    expect(rootPackage.exports['./adopter']).toBeUndefined();
  });

  it('keeps a bounded contract, JOSE, SSE, and official MCP boundary', () => {
    expect(adopterPackage.dependencies).toEqual({
      '@modelcontextprotocol/sdk':
        rootPackage.dependencies['@modelcontextprotocol/sdk'],
      'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
      jose: rootPackage.devDependencies.jose,
      zod: rootPackage.dependencies.zod,
    });
    expect(adopterPackage.dependencies['@roackb2/heddle']).toBeUndefined();
    expect(adopterPackage.dependencies['@aws-sdk/client-bedrock-agentcore'])
      .toBeUndefined();
  });

  it('publishes only its intentional subpaths', () => {
    expect(Object.keys(adopterPackage.exports)).toEqual([
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
    ]);
  });
});

function readPackage(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
