import type { ChatSession } from '@/core/chat/types.js';
import {
  FileChatSessionRepository,
  type ChatSessionCatalogEntry,
  type ListChatSessionsInput,
} from '@/core/chat/engine/sessions/repository/index.js';

export async function seedChatSessionRepository(
  repository: FileChatSessionRepository,
  sessions: ChatSession[],
): Promise<void> {
  for (const session of sessions) {
    await repository.create(session);
  }
}

export async function readStoredChatSession(
  repository: FileChatSessionRepository,
  sessionId: string,
): Promise<ChatSession | undefined> {
  return (await repository.read(sessionId))?.session;
}

export async function listStoredChatSessions(
  repository: FileChatSessionRepository,
  filters: Pick<ListChatSessionsInput, 'archived' | 'workspaceId'> = {},
): Promise<ChatSession[]> {
  const entries = await listChatSessionCatalog(repository, filters);
  const records = await Promise.all(entries.map((entry) => repository.read(entry.id)));
  return records.flatMap((record) => record ? [record.session] : []);
}

export async function listChatSessionCatalog(
  repository: FileChatSessionRepository,
  filters: Pick<ListChatSessionsInput, 'archived' | 'workspaceId'> = {},
): Promise<ChatSessionCatalogEntry[]> {
  const entries: ChatSessionCatalogEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await repository.list({
      ...filters,
      cursor,
      limit: 200,
    });
    entries.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return entries;
}
