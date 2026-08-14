import { describe, expect, it } from 'vitest';
import {
  assertDistTagTransition,
  assertRegistryArtifactMatches,
  createExecutionHostClientReleaseMetadata,
  parseRegistryArtifactResult,
  selectExecutionHostClientRelease,
} from '../../../../scripts/execution-host-client-release-state.mjs';

const packageJson = {
  name: '@heddleagent/execution-host-client',
  version: '6.0.0-next.1',
  publishConfig: {
    access: 'public',
    tag: 'next',
    registry: 'https://registry.npmjs.org/',
  },
};

describe('Execution Host client release state', () => {
  it('derives an explicit prerelease identity from the package manifest', () => {
    expect(createExecutionHostClientReleaseMetadata(packageJson)).toEqual({
      name: '@heddleagent/execution-host-client',
      version: '6.0.0-next.1',
      publishTag: 'next',
      prerelease: true,
      releaseTag: 'execution-host-client-v6.0.0-next.1',
      releaseNote:
        'docs/releases/execution-host-client-v6.0.0-next.1.md',
      releaseTitle: 'Execution Host Client v6.0.0-next.1',
    });
  });

  it('rejects publishing a prerelease through latest', () => {
    expect(() =>
      createExecutionHostClientReleaseMetadata({
        ...packageJson,
        publishConfig: { ...packageJson.publishConfig, tag: 'latest' },
      }),
    ).toThrow('Prereleases must use next');
  });

  it('classifies only a registry 404 as an absent version', () => {
    expect(
      parseRegistryArtifactResult(
        { status: 1, stdout: '', stderr: 'npm error code E404' },
        '@heddleagent/execution-host-client@6.0.0-next.1',
      ),
    ).toEqual({ kind: 'missing' });

    expect(() =>
      parseRegistryArtifactResult(
        { status: 1, stdout: '', stderr: 'npm error code E401' },
        '@heddleagent/execution-host-client@6.0.0-next.1',
      ),
    ).toThrow('failed for a reason other than an absent immutable version');
  });

  it('parses and verifies immutable registry integrity', () => {
    const artifact = parseRegistryArtifactResult(
      {
        status: 0,
        stdout: JSON.stringify({
          version: '6.0.0-next.0',
          'dist.integrity': 'sha512-exact',
        }),
        stderr: '',
      },
      '@heddleagent/execution-host-client@6.0.0-next.0',
    );

    expect(() =>
      assertRegistryArtifactMatches(artifact, {
        version: '6.0.0-next.0',
        integrity: 'sha512-exact',
      }),
    ).not.toThrow();
    expect(() =>
      assertRegistryArtifactMatches(artifact, {
        version: '6.0.0-next.0',
        integrity: 'sha512-different',
      }),
    ).toThrow('differs from the verified local tarball');
  });

  it('preserves stable latest while advancing next', () => {
    expect(() =>
      assertDistTagTransition({
        before: { latest: '5.9.0', next: '6.0.0-next.0' },
        after: { latest: '5.9.0', next: '6.0.0-next.1' },
        publishTag: 'next',
        version: '6.0.0-next.1',
      }),
    ).not.toThrow();
    expect(() =>
      assertDistTagTransition({
        before: { latest: '5.9.0', next: '6.0.0-next.0' },
        after: { latest: '6.0.0-next.1', next: '6.0.0-next.1' },
        publishTag: 'next',
        version: '6.0.0-next.1',
      }),
    ).toThrow('must not move the existing latest');
  });

  it('accepts npm seeding required latest on a first prerelease', () => {
    expect(() =>
      assertDistTagTransition({
        before: {},
        after: {
          latest: '6.0.0-next.0',
          next: '6.0.0-next.0',
        },
        publishTag: 'next',
        version: '6.0.0-next.0',
      }),
    ).not.toThrow();
  });

  it('selects missing versions and same-commit release recovery only', () => {
    expect(
      selectExecutionHostClientRelease({
        artifact: { kind: 'missing' },
        releaseTagPointsAtHead: false,
      }),
    ).toEqual({ publicationNeeded: true, releaseSelected: true });
    expect(
      selectExecutionHostClientRelease({
        artifact: {
          kind: 'published',
          version: '6.0.0-next.0',
          integrity: 'sha512-exact',
        },
        releaseTagPointsAtHead: true,
      }),
    ).toEqual({ publicationNeeded: false, releaseSelected: true });
    expect(
      selectExecutionHostClientRelease({
        artifact: {
          kind: 'published',
          version: '6.0.0-next.0',
          integrity: 'sha512-exact',
        },
        releaseTagPointsAtHead: false,
      }),
    ).toEqual({ publicationNeeded: false, releaseSelected: false });
  });
});
