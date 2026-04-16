import { resolve } from 'node:path';
import {
  listenHeddleDaemon,
  projectChatSessionView,
} from '../server/index.js';
import type { HeddleServerListenOptions } from '../server/index.js';

export type DaemonCliOptions = {
  workspaceRoot?: string;
  stateDir?: string;
};

export type DaemonArgs = {
  host: string;
  port: number;
  assetsDir?: string;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8765;

export { projectChatSessionView };

export async function runDaemonCli(args: string[], options: DaemonCliOptions = {}) {
  const parsed = parseDaemonArgs(args);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateDir = options.stateDir ?? '.heddle';
  const listenOptions: HeddleServerListenOptions = {
    workspaceRoot,
    stateRoot: resolve(workspaceRoot, stateDir),
    host: parsed.host,
    port: parsed.port,
    assetsDir: parsed.assetsDir,
  };

  await listenHeddleDaemon(listenOptions);
}

export function parseDaemonArgs(args: string[]): DaemonArgs {
  const flags = parseFlags(args);
  return {
    host: stringFlag(flags, 'host') ?? DEFAULT_HOST,
    port: parsePort(stringFlag(flags, 'port')) ?? DEFAULT_PORT,
    assetsDir: stringFlag(flags, 'assets-dir'),
  };
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index++;
  }
  return flags;
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function parsePort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 && value <= 65_535 ? value : undefined;
}
