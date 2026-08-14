import assert from 'node:assert/strict';

/**
 * Normalize the single version returned by `npm view ... version --json`.
 * npm 10 emits a string while npm 12 may wrap the same result in an array.
 */
export function parseNpmViewVersion(stdout, target) {
  const parsed = JSON.parse(stdout);
  const versions = Array.isArray(parsed) ? parsed : [parsed];

  assert.equal(
    versions.length,
    1,
    `Registry lookup for ${target} must return exactly one version.`,
  );
  assert.equal(
    typeof versions[0],
    'string',
    `Registry lookup for ${target} did not return a version string.`,
  );

  return versions[0];
}
