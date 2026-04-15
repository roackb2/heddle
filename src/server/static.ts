import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';

export function assertWebAssetsBuilt(assetsDir: string) {
  const indexPath = join(assetsDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Web assets not found at ${assetsDir}. Run yarn build before starting heddle daemon.`);
  }
}

export function installWebStaticRoutes(app: express.Express, assetsDir: string) {
  const indexPath = join(assetsDir, 'index.html');
  app.use(express.static(assetsDir, {
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
