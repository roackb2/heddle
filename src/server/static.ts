import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';

export function assertWebAssetsBuilt(assetsDir: string) {
  const resolvedAssetsDir = resolve(assetsDir);
  const indexPath = join(resolvedAssetsDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Web assets not found at ${resolvedAssetsDir}. Run yarn build before starting heddle daemon.`);
  }
}

export function installWebStaticRoutes(app: express.Express, assetsDir: string) {
  const resolvedAssetsDir = resolve(assetsDir);
  const indexPath = join(resolvedAssetsDir, 'index.html');
  app.use(express.static(resolvedAssetsDir, {
    immutable: true,
    index: false,
    maxAge: '1y',
  }));
  app.get(/.*/, (_request, response) => {
    response.sendFile(indexPath, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  });
}
