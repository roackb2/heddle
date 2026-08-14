import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DEFINITIONS,
  assertDurablePortInventory,
  assertDurableStateSurfaceInventory,
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

describe('platform durable-state surface tracker', () => {
  const tracker = JSON.parse(
    readFileSync(
      new URL(
        '../../../../docs/architecture/durable-state-surfaces.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const postgresInventory = JSON.parse(
    readFileSync(
      new URL(
        '../../../../packages/postgres/durable-port-support.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );

  it('accepts every reviewed platform state surface', () => {
    expect(() =>
      assertDurableStateSurfaceInventory(tracker, postgresInventory),
    ).not.toThrow();
  });

  it('rejects a missing platform state surface', () => {
    expect(() =>
      assertDurableStateSurfaceInventory(
        {
          ...tracker,
          surfaces: tracker.surfaces.filter(
            (surface: { id: string }) =>
              surface.id !== 'workspace-continuity-checkpoints',
          ),
        },
        postgresInventory,
      ),
    ).toThrow(/exactly the reviewed platform state surfaces/);
  });

  it('rejects a duplicate platform state surface', () => {
    expect(() =>
      assertDurableStateSurfaceInventory(
        {
          ...tracker,
          surfaces: [...tracker.surfaces, tracker.surfaces[0]],
        },
        postgresInventory,
      ),
    ).toThrow(/duplicate/);
  });

  it.each([
    ['stateClass', 'diagnostic'],
    ['backendClass', 'process-local'],
    ['contractStatus', 'no-port'],
    ['officialAdapterStatus', 'not-applicable'],
  ])('rejects silently changing %s', (field, replacement) => {
    expect(() =>
      assertDurableStateSurfaceInventory(
        {
          ...tracker,
          surfaces: tracker.surfaces.map(
            (surface: Record<string, unknown> & { id: string }) =>
              surface.id === 'conversation-sessions'
                ? { ...surface, [field]: replacement }
                : surface,
          ),
        },
        postgresInventory,
      ),
    ).toThrow(new RegExp(`${field} must retain its reviewed status`));
  });

  it('rejects an unreviewed PostgreSQL decision mapping', () => {
    expect(() =>
      assertDurableStateSurfaceInventory(
        {
          ...tracker,
          surfaces: tracker.surfaces.map(
            (surface: Record<string, unknown> & { id: string }) =>
              surface.id === 'conversation-sessions'
                ? { ...surface, postgresDecisionId: 'unknown-port' }
                : surface,
          ),
        },
        postgresInventory,
      ),
    ).toThrow(/reviewed PostgreSQL decision mapping/);
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

  it('rejects silently changing a launch policy', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'conversation-sessions'
            ? {
                ...port,
                launchPolicy: 'deferred',
                exclusionRationale: 'silently dropped',
              }
            : port,
        ),
      }),
    ).toThrow(/launchPolicy must retain its reviewed status/);
  });

  it('rejects confusing selection with implementation availability', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'conversation-sessions'
            ? { ...port, implementationStatus: 'existing-v5' }
            : port,
        ),
      }),
    ).toThrow(/implementationStatus must retain its reviewed status/);
  });

  it.each(['conformance', 'plannedAdapterEntryPoint', 'implementationGate'])(
    'requires %s for launch adapters',
    (field) => {
      expect(() =>
        assertDurablePortInventory({
          ...inventory,
          ports: inventory.ports.map((port: { id: string }) =>
            port.id === 'conversation-sessions'
              ? { ...port, [field]: '' }
              : port,
          ),
        }),
      ).toThrow(new RegExp(`${field} must not be empty`));
    },
  );

  it('rejects technology names in domain contracts', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'conversation-sessions'
            ? { ...port, portContracts: ['PostgresChatSessionRepository'] }
            : port,
        ),
      }),
    ).toThrow(/technology-neutral domain contracts/);
  });

  it('rejects assigning a domain port to the adapter package', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'conversation-sessions'
            ? { ...port, portOwnerPackage: '@heddleagent/postgres' }
            : port,
        ),
      }),
    ).toThrow(/domain package rather than the PostgreSQL adapter package/);
  });

  it('requires launch entrypoints to belong to the adapter package', () => {
    expect(() =>
      assertDurablePortInventory({
        ...inventory,
        ports: inventory.ports.map((port: { id: string }) =>
          port.id === 'conversation-sessions'
            ? {
                ...port,
                plannedAdapterEntryPoint: '@another/package/conversations',
              }
            : port,
        ),
      }),
    ).toThrow(/must start with @heddleagent\/postgres\//);
  });

  it('requires a rationale for every unselected adapter', () => {
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
