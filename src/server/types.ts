import type { Logger } from 'pino';

export type HeddleServerOptions = {
  workspaceRoot: string;
  stateRoot: string;
  assetsDir?: string;
  logger?: Logger;
};

export type HeddleServerListenOptions = HeddleServerOptions & {
  host: string;
  port: number;
};

export type HeddleServerContext = {
  workspaceRoot: string;
  stateRoot: string;
  logger: Logger;
};
