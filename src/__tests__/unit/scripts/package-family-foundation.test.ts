import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DEFINITIONS,
  assertDurablePortInventory,
  assertFoundationManifest,
  createFoundationManifest,
} from '../../../../scripts/verify-package-family.mjs';

const NODE_VERSION = '>=20';

describe('v6 package-family foundation', () => {
  it('accepts only the exact metadata-only private manifest', () => {
    const definition = PACKAGE_DEFINITIONS[0];
    const manifest = createFoundationManifest(definition, NODE_VERSION);

    expect(() =>
      assertFoundationManifest(manifest, definition, NODE_VERSION),
    ).not.toThrow();
  });

  it.each([
    ['public flag', { private: false }],
    ['wrong name', { name: '@heddleagent/not-runtime' }],
    ['exports', { exports: { '.': './dist/index.js' } }],
    ['binary', { bin: { heddle: './dist/cli.js' } }],
    ['dependency', { dependencies: { zod: '^4.0.0' } }],
    ['publish configuration', { publishConfig: { access: 'public' } }],
  ])('rejects an unsafe %s mutation', (_label, mutation) => {
    const definition = PACKAGE_DEFINITIONS[0];
    const manifest = {
      ...createFoundationManifest(definition, NODE_VERSION),
      ...mutation,
    };

    expect(() =>
      assertFoundationManifest(manifest, definition, NODE_VERSION),
    ).toThrow();
  });
});

describe('PostgreSQL durable-port inventory', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL(
        '../../../../packages/postgres/durable-port-support.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

  it('accepts the reviewed support matrix', () => {
    expect(() => assertDurablePortInventory(inventory)).not.toThrow();
  });

  it('rejects a missing state surface', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.slice(1),
      }),
    ).toThrow(/exactly the reviewed/);
  });

  it('rejects a duplicate state surface', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: [...inventory.ports, inventory.ports[0]],
      }),
    ).toThrow(/duplicate/);
  });

  it('rejects silently reclassifying a required adapter', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'conversation-sessions'
            ? {
                ...port,
                v6Status: 'excluded',
                exclusionRationale: 'silently dropped',
              }
            : port,
        ),
      }),
    ).toThrow(/reviewed v6 launch status/);
  });

  it('requires conformance and implementation gates for launch adapters', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'conversation-sessions'
            ? { ...port, conformance: '' }
            : port,
        ),
      }),
    ).toThrow(/conformance must not be empty/);
  });

  it('requires a rationale for every launch exclusion', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'result-artifacts'
            ? { ...port, exclusionRationale: '' }
            : port,
        ),
      }),
    ).toThrow(/exclusionRationale must not be empty/);
  });
});
