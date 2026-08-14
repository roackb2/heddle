import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DEFINITIONS,
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
