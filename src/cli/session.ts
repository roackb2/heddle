import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileChatSessionRepository } from '../core/chat/engine/sessions/repository/index.js';

export type SessionCliOptions = {
  workspaceRoot?: string;
  stateDir?: string;
};

export async function runSessionCli(args: string[], options: SessionCliOptions = {}) {
  const parsed = parseSessionArgs(args);
  if (parsed.command !== 'migrate') {
    process.stdout.write('Usage: heddle session migrate\n');
    return;
  }

  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const stateDir = options.stateDir ?? '.heddle';
  const sessionsPath = resolve(workspaceRoot, stateDir, 'chat-sessions.json');
  const repository = new FileChatSessionRepository({ sessionStoragePath: sessionsPath });
  const paths = FileChatSessionRepository.deriveStoragePaths(sessionsPath);
  const hadLegacyFile = existsSync(paths.legacyPath);
  const hadCatalog = existsSync(paths.catalogPath);

  const sessions = repository.migrateLegacy(true);

  process.stdout.write(
    [
      `Migrated ${sessions.length} chat sessions.`,
      `Legacy file: ${hadLegacyFile ? 'preserved' : 'not found'} at ${paths.legacyPath}`,
      `Catalog: ${existsSync(paths.catalogPath) ? (hadCatalog ? 'updated' : 'created') : 'missing'} at ${paths.catalogPath}`,
      `Per-session directory: ${paths.sessionsDir}`,
    ].join('\n') + '\n',
  );
}

type SessionArgs = {
  command?: 'migrate';
};

export function parseSessionArgs(args: string[]): SessionArgs {
  const [command] = args;
  return {
    command: command === 'migrate' ? 'migrate' : undefined,
  };
}
