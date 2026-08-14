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
  version: '6.0.0',
  publishConfig: {
    access: 'public',
    tag: 'latest',
    registry: 'https://registry.npmjs.org/',
  },
};

describe('Execution Host client release state', () => {
  it('derives a stable release identity from the package manifest', () => {
    expect(createExecutionHostClientReleaseMetadata(packageJson)).toEqual({
      name: '@heddleagent/execution-host-client',
      version: '6.0.0',
      releaseTag: 'execution-host-client-v6.0.0',
      releaseNote: 'docs/releases/execution-host-client-v6.0.0.md',
      releaseTitle: 'Execution Host Client v6.0.0',
    });
  });

  it('rejects non-stable channels', () => {
    expect(() =>
      createExecutionHostClientReleaseMetadata({
        ...packageJson,
        publishConfig: { ...packageJson.publishConfig, tag: 'next' },
      }),
    ).toThrow('must use the stable latest channel');
  });

  it('classifies only a registry 404 as an absent version', () => {
    expect(
      parseRegistryArtifactResult(
        { status: 1, stdout: '', stderr: 'npm error code E404' },
        '@heddleagent/execution-host-client@6.0.0',
      ),
    ).toEqual({ kind: 'missing' });

    expect(() =>
      parseRegistryArtifactResult(
        { status: 1, stdout: '', stderr: 'npm error code E401' },
        '@heddleagent/execution-host-client@6.0.0',
      ),
    ).toThrow('failed for a reason other than an absent immutable version');
  });

  it('parses and verifies immutable registry integrity', () => {
    const artifact = parseRegistryArtifactResult(
      {
        status: 0,
        stdout: JSON.stringify({
          version: '6.0.0',
          'dist.integrity': 'sha512-exact',
        }),
        stderr: '',
      },
      '@heddleagent/execution-host-client@6.0.0',
    );

    expect(() =>
      assertRegistryArtifactMatches(artifact, {
        version: '6.0.0',
        integrity: 'sha512-exact',
      }),
    ).not.toThrow();
    expect(() =>
      assertRegistryArtifactMatches(artifact, {
        version: '6.0.0',
        integrity: 'sha512-different',
      }),
    ).toThrow('differs from the verified local tarball');
  });

  it('moves latest to the stable release while preserving other channels', () => {
    expect(() =>
      assertDistTagTransition({
        before: {
          latest: '6.0.0-next.0',
          next: '6.0.0-next.0',
        },
        after: { latest: '6.0.0', next: '6.0.0-next.0' },
        version: '6.0.0',
      }),
    ).not.toThrow();
    expect(() =>
      assertDistTagTransition({
        before: {
          latest: '6.0.0-next.0',
          next: '6.0.0-next.0',
        },
        after: { latest: '6.0.0', next: '6.0.0' },
        version: '6.0.0',
      }),
    ).toThrow('must not move the existing next');
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
          version: '6.0.0',
          integrity: 'sha512-exact',
        },
        releaseTagPointsAtHead: true,
      }),
    ).toEqual({ publicationNeeded: false, releaseSelected: true });
    expect(
      selectExecutionHostClientRelease({
        artifact: {
          kind: 'published',
          version: '6.0.0',
          integrity: 'sha512-exact',
        },
        releaseTagPointsAtHead: false,
      }),
    ).toEqual({ publicationNeeded: false, releaseSelected: false });
  });
});
