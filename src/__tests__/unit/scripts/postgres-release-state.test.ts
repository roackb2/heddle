import { describe, expect, it } from 'vitest';
import {
  createPostgresReleaseMetadata,
  selectPostgresRelease,
} from '../../../../scripts/postgres-release-state.mjs';

const packageJson = {
  name: '@heddleagent/postgres',
  version: '6.0.0',
  publishConfig: {
    access: 'public',
    tag: 'latest',
    registry: 'https://registry.npmjs.org/',
  },
};

describe('PostgreSQL package release state', () => {
  it('derives the package-specific stable release identity', () => {
    expect(createPostgresReleaseMetadata(packageJson)).toEqual({
      name: '@heddleagent/postgres',
      version: '6.0.0',
      releaseTag: 'postgres-v6.0.0',
      releaseNote: 'docs/releases/postgres-v6.0.0.md',
      releaseTitle: 'Heddle PostgreSQL Adapters v6.0.0',
    });
  });

  it('rejects a prerelease channel or another registry', () => {
    expect(() => createPostgresReleaseMetadata({
      ...packageJson,
      publishConfig: { ...packageJson.publishConfig, tag: 'next' },
    })).toThrow('must use the stable latest channel');
    expect(() => createPostgresReleaseMetadata({
      ...packageJson,
      publishConfig: {
        ...packageJson.publishConfig,
        registry: 'https://registry.example.com/',
      },
    })).toThrow();
  });

  it('selects a missing version and same-commit recovery only', () => {
    expect(selectPostgresRelease({
      artifact: { kind: 'missing' },
      releaseTagPointsAtHead: false,
    })).toEqual({ publicationNeeded: true, releaseSelected: true });
    expect(selectPostgresRelease({
      artifact: {
        kind: 'published',
        version: '6.0.0',
        integrity: 'sha512-exact',
      },
      releaseTagPointsAtHead: true,
    })).toEqual({ publicationNeeded: false, releaseSelected: true });
    expect(selectPostgresRelease({
      artifact: {
        kind: 'published',
        version: '6.0.0',
        integrity: 'sha512-exact',
      },
      releaseTagPointsAtHead: false,
    })).toEqual({ publicationNeeded: false, releaseSelected: false });
  });
});
