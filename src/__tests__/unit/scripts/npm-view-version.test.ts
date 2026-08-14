import { describe, expect, it } from 'vitest';
import { parseNpmViewVersion } from '../../../../scripts/npm-view-version.mjs';

describe('npm view version parsing', () => {
  it.each([
    ['npm 10 scalar output', '"6.0.0"'],
    ['npm 12 single-result output', '["6.0.0"]'],
  ])('accepts %s', (_label, output) => {
    expect(parseNpmViewVersion(output, '@heddleagent/example@6.0.0'))
      .toBe('6.0.0');
  });

  it('rejects ambiguous version output', () => {
    expect(() => parseNpmViewVersion(
      '["6.0.0", "6.1.0"]',
      '@heddleagent/example@6.0.0',
    )).toThrow('must return exactly one version');
  });
});
