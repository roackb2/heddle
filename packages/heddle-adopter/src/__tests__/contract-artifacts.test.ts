import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createContractArtifacts } from '../../scripts/contract-artifacts.js';

const specRoot = new URL('../../spec/v1/', import.meta.url);

describe('published language-neutral contract artifacts', () => {
  it('stay byte-for-byte synchronized with runtime schemas', async () => {
    for (const [relativePath, expected] of createContractArtifacts()) {
      await expect(readFile(new URL(relativePath, specRoot), 'utf8'))
        .resolves.toBe(expected);
    }
  });

  it('ships a self-contained OpenAPI 3.1.1 operation and schema bundle', async () => {
    const openApi = await readJson('openapi.json');
    const schemaBundle = await readJson('schema-bundle.json');

    expect(openApi).toMatchObject({
      openapi: '3.1.1',
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      paths: {
        '/invocations': {
          post: {
            operationId: 'streamConversationTurn',
            responses: { 200: expect.any(Object) },
          },
        },
      },
    });
    expect(schemaBundle).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {
        ConversationTurnRequest: expect.any(Object),
        StreamEvent: expect.any(Object),
        ExecutionAssertionClaims: expect.any(Object),
        McpCapabilityClaims: expect.any(Object),
      },
    });
  });
});

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(relativePath, specRoot), 'utf8'),
  ) as Record<string, unknown>;
}
