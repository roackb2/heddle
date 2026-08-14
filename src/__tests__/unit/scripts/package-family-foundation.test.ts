import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DEFINITIONS,
  assertFoundationManifest,
  createFoundationManifest,
} from '../../../../scripts/verify-package-family.mjs';
import {
  assertExecutionHostClientManifest,
  createExecutionHostClientManifest,
} from '../../../../scripts/verify-execution-host-client-package.mjs';

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

const NODE_VERSION = '>=20';

describe('v6 package-family foundation', () => {
  it('keeps exactly four packages as private foundations', () => {
    expect(PACKAGE_DEFINITIONS.map(({ name }) => name)).toEqual([
      '@heddleagent/runtime',
      '@heddleagent/cli',
      '@heddleagent/run-client',
      '@heddleagent/postgres',
    ]);
  });

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

describe('@heddleagent/execution-host-client activation', () => {
  it('accepts the exact independently versioned next-channel manifest', () => {
    const manifest = createExecutionHostClientManifest(rootPackage);

    expect(() =>
      assertExecutionHostClientManifest(manifest, rootPackage),
    ).not.toThrow();
  });

  it.each([
    ['old coordinate', { name: '@roackb2/heddle-adopter' }],
    ['wrong version', { version: rootPackage.version }],
    ['private package', { private: true }],
    ['latest tag', {
      publishConfig: {
        access: 'public',
        tag: 'latest',
        registry: 'https://registry.npmjs.org/',
      },
    }],
    ['wrong registry', {
      publishConfig: {
        access: 'public',
        tag: 'next',
        registry: 'https://registry.example.com/',
      },
    }],
    ['wrong repository', {
      repository: {
        ...createExecutionHostClientManifest(rootPackage).repository,
        directory: 'packages/heddle-adopter',
      },
    }],
    ['runtime dependency', {
      dependencies: {
        ...createExecutionHostClientManifest(rootPackage).dependencies,
        '@heddleagent/runtime': '^6.0.0-next.0',
      },
    }],
    ['extra export', {
      exports: {
        ...createExecutionHostClientManifest(rootPackage).exports,
        './internal': './dist/internal.js',
      },
    }],
  ])('rejects an unsafe %s mutation', (_label, mutation) => {
    const manifest = {
      ...createExecutionHostClientManifest(rootPackage),
      ...mutation,
    };

    expect(() =>
      assertExecutionHostClientManifest(manifest, rootPackage),
    ).toThrow();
  });
});
