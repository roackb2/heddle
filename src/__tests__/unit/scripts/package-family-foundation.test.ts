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
import {
  assertPostgresManifest,
  createPostgresManifest,
} from '../../../../scripts/verify-postgres-package.mjs';
import {
  assertRunClientManifest,
  createRunClientManifest,
} from '../../../../scripts/verify-run-client-package.mjs';

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

const NODE_VERSION = '>=20';

describe('v6 package-family foundation', () => {
  it('keeps exactly two packages as private foundations', () => {
    expect(PACKAGE_DEFINITIONS.map(({ name }) => name)).toEqual([
      '@heddleagent/runtime',
      '@heddleagent/cli',
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

describe('@heddleagent/run-client activation', () => {
  it('accepts the exact browser-safe stable manifest', () => {
    const manifest = createRunClientManifest(rootPackage);

    expect(() => assertRunClientManifest(manifest, rootPackage)).not.toThrow();
  });

  it.each([
    ['old coordinate', { name: '@roackb2/heddle-remote' }],
    ['private package', { private: true }],
    ['wrong version', { version: rootPackage.version }],
    ['runtime dependency', {
      dependencies: {
        ...createRunClientManifest(rootPackage).dependencies,
        '@heddleagent/runtime': '^6.0.0',
      },
    }],
  ])('rejects an unsafe %s mutation', (_label, mutation) => {
    const manifest = {
      ...createRunClientManifest(rootPackage),
      ...mutation,
    };

    expect(() => assertRunClientManifest(manifest, rootPackage)).toThrow();
  });
});

describe('@heddleagent/postgres activation', () => {
  it('accepts the exact independently versioned stable manifest', () => {
    const manifest = createPostgresManifest(rootPackage);

    expect(() => assertPostgresManifest(manifest, rootPackage)).not.toThrow();
  });

  it.each([
    ['wrong coordinate', { name: '@heddleagent/storage' }],
    ['wrong version', { version: '0.0.0' }],
    ['private package', { private: true }],
    ['non-stable tag', {
      publishConfig: {
        access: 'public',
        tag: 'next',
        registry: 'https://registry.npmjs.org/',
      },
    }],
    ['wrong repository', {
      repository: {
        ...createPostgresManifest(rootPackage).repository,
        directory: 'packages/heddle-postgres',
      },
    }],
    ['generic root export', {
      exports: {
        ...createPostgresManifest(rootPackage).exports,
        '.': './dist/index.js',
      },
    }],
    ['runtime dependency', {
      dependencies: {
        ...createPostgresManifest(rootPackage).dependencies,
        '@heddleagent/runtime': '^6.0.0',
      },
    }],
    ['unsupported adapter export', {
      exports: {
        ...createPostgresManifest(rootPackage).exports,
        './heartbeat': './dist/heartbeat/index.js',
      },
    }],
  ])('rejects an unsafe %s mutation', (_label, mutation) => {
    const manifest = {
      ...createPostgresManifest(rootPackage),
      ...mutation,
    };

    expect(() => assertPostgresManifest(manifest, rootPackage)).toThrow();
  });
});

describe('@heddleagent/execution-host-client activation', () => {
  it('accepts the exact independently versioned stable manifest', () => {
    const manifest = createExecutionHostClientManifest(rootPackage);

    expect(() =>
      assertExecutionHostClientManifest(manifest, rootPackage),
    ).not.toThrow();
  });

  it.each([
    ['old coordinate', { name: '@roackb2/heddle-adopter' }],
    ['wrong version', { version: rootPackage.version }],
    ['private package', { private: true }],
    ['non-stable tag', {
      publishConfig: {
        access: 'public',
        tag: 'next',
        registry: 'https://registry.npmjs.org/',
      },
    }],
    ['wrong registry', {
      publishConfig: {
        access: 'public',
        tag: 'latest',
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
        '@heddleagent/runtime': '^6.0.0',
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
