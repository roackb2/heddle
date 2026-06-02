import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDefaultAssetsDir } from '@/server/lifecycle.js';
import { assertWebAssetsBuilt, isWebAssetsBuilt } from '@/server/static.js';

describe('control-plane static assets', () => {
  it('prefers built web assets over Vite source assets when running from source', () => {
    const root = createTempProject('heddle-static-assets-');
    const sourceAssetsDir = join(root, 'src', 'web-v2');
    const builtAssetsDir = join(root, 'dist', 'src', 'web-v2');
    writeIndex(sourceAssetsDir);
    writeIndex(builtAssetsDir);
    mkdirSync(join(builtAssetsDir, 'assets'), { recursive: true });

    expect(resolveDefaultAssetsDir({
      moduleDir: join(root, 'src', 'server'),
      env: {},
    })).toBe(builtAssetsDir);
  });

  it('does not treat Vite source HTML as built static assets', () => {
    const root = createTempProject('heddle-static-source-');
    const sourceAssetsDir = join(root, 'src', 'web-v2');
    writeIndex(sourceAssetsDir);

    expect(isWebAssetsBuilt(sourceAssetsDir)).toBe(false);
    expect(() => assertWebAssetsBuilt(sourceAssetsDir)).toThrow('Built web assets not found');
  });
});

function createTempProject(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeIndex(assetsDir: string) {
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
}
