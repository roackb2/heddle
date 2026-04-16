import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHeddleServerApp } from './app.js';
import { createServerLogger } from './logger.js';
import { assertWebAssetsBuilt } from './static.js';
import type { HeddleServerListenOptions } from './types.js';

export type { HeddleServerListenOptions, HeddleServerOptions } from './types.js';
export { appRouter, type AppRouter } from './router.js';
export { createHeddleServerApp } from './app.js';
export { createServerLogger } from './logger.js';
export { projectChatSessionView } from './features/control-plane/services/chat-sessions.js';

export async function listenHeddleDaemon(options: HeddleServerListenOptions): Promise<void> {
  const assetsDir = options.assetsDir ?? resolveDefaultAssetsDir();
  assertWebAssetsBuilt(assetsDir);
  const logger = options.logger ?? createServerLogger({ stateRoot: options.stateRoot });
  const app = createHeddleServerApp({ ...options, assetsDir, logger });

  await new Promise<void>((resolveListen, rejectListen) => {
    const server = app.listen(options.port, options.host, () => {
      server.off('error', rejectListen);
      logger.info({
        host: options.host,
        port: options.port,
        workspaceRoot: options.workspaceRoot,
        stateRoot: options.stateRoot,
        assetsDir,
      }, 'Heddle server started');
      process.stdout.write(`Heddle server listening at http://${options.host}:${options.port}\n`);
      process.stdout.write(`workspace=${options.workspaceRoot}\n`);
      resolveListen();
    });
    server.once('error', (error) => {
      logger.error({ error }, 'Heddle server failed');
      rejectListen(error);
    });
  });
}

export const listenHeddleServer = listenHeddleDaemon;

function resolveDefaultAssetsDir(): string {
  if (process.env.HEDDLE_WEB_DIST) {
    return resolve(process.env.HEDDLE_WEB_DIST);
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../web'),
    resolve(moduleDir, '../../web'),
    resolve(moduleDir, '../../../src/web'),
  ];

  for (const candidate of candidates) {
    const indexPath = resolve(candidate, 'index.html');
    if (existsSync(indexPath)) {
      return candidate;
    }
  }

  return candidates[0];
}
