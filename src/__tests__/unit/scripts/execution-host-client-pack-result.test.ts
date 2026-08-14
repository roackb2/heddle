import { describe, expect, it } from 'vitest';
import { parseNpmPackResult } from '../../../../scripts/execution-host-client-pack-result.mjs';

const PACKAGE_NAME = '@heddleagent/execution-host-client';
const packed = {
  name: PACKAGE_NAME,
  version: '6.0.0',
  filename: 'heddleagent-execution-host-client-6.0.0.tgz',
  files: [],
};

describe('parseNpmPackResult', () => {
  it('accepts the npm 10 array result', () => {
    expect(parseNpmPackResult(JSON.stringify([packed]), PACKAGE_NAME)).toEqual(
      packed,
    );
  });

  it('accepts the npm 12 package-keyed result', () => {
    expect(
      parseNpmPackResult(
        JSON.stringify({ [PACKAGE_NAME]: packed }),
        PACKAGE_NAME,
      ),
    ).toEqual(packed);
  });

  it.each([
    ['invalid JSON', 'not-json'],
    ['an empty array', '[]'],
    ['multiple array entries', JSON.stringify([packed, packed])],
    ['a scalar', 'null'],
    ['an empty object', '{}'],
    [
      'the wrong package key',
      JSON.stringify({ '@heddleagent/other': packed }),
    ],
    [
      'multiple object entries',
      JSON.stringify({
        [PACKAGE_NAME]: packed,
        '@heddleagent/other': packed,
      }),
    ],
    [
      'a mismatched package name',
      JSON.stringify([{ ...packed, name: '@heddleagent/other' }]),
    ],
  ])('rejects %s', (_label, stdout) => {
    expect(() => parseNpmPackResult(stdout, PACKAGE_NAME)).toThrow();
  });
});
