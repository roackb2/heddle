import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootPackage = readPackage('package.json');
const executionHostClientPackage = readPackage(
  'packages/execution-host-client/package.json',
);

describe('@heddleagent/execution-host-client package boundary', () => {
  it('is a stable package without becoming a root subpath', () => {
    expect(executionHostClientPackage.name).toBe(
      '@heddleagent/execution-host-client',
    );
    expect(executionHostClientPackage.version).toBe('6.0.0');
    expect(executionHostClientPackage.private).toBeUndefined();
    expect(executionHostClientPackage.publishConfig).toEqual({
      access: 'public',
      tag: 'latest',
      registry: 'https://registry.npmjs.org/',
    });
    expect(executionHostClientPackage.repository.directory).toBe(
      'packages/execution-host-client',
    );
    expect(rootPackage.exports['./adopter']).toBeUndefined();
    expect(rootPackage.exports['./execution-host-client']).toBeUndefined();
  });

  it('keeps a bounded contract, lifecycle, JOSE, SSE, and official MCP boundary', () => {
    expect(executionHostClientPackage.dependencies).toEqual({
      '@modelcontextprotocol/sdk':
        rootPackage.dependencies['@modelcontextprotocol/sdk'],
      dayjs: rootPackage.dependencies.dayjs,
      'eventsource-parser': rootPackage.devDependencies['eventsource-parser'],
      jose: rootPackage.devDependencies.jose,
      zod: rootPackage.dependencies.zod,
    });
    expect(executionHostClientPackage.dependencies).not.toHaveProperty(
      '@roackb2/heddle',
    );
    expect(executionHostClientPackage.dependencies).not.toHaveProperty(
      '@roackb2/heddle-adopter',
    );
    expect(executionHostClientPackage.dependencies).not.toHaveProperty(
      '@heddleagent/runtime',
    );
    expect(executionHostClientPackage.dependencies).not.toHaveProperty(
      '@heddleagent/postgres',
    );
    expect(executionHostClientPackage.dependencies).not.toHaveProperty(
      '@aws-sdk/client-bedrock-agentcore',
    );
  });

  it('publishes only its intentional subpaths', () => {
    expect(Object.keys(executionHostClientPackage.exports)).toEqual([
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
