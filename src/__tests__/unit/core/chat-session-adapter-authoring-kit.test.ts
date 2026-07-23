import { describe, expect, it } from 'vitest';
import {
  ChatSessionCatalogPagination,
  ChatSessionPersistenceCodec,
  InvalidChatSessionCursorError,
} from '../../../index.js';
import { ChatSessionRecords } from '../../../core/chat/engine/sessions/records/index.js';

const createSessionRecord = () => ({
  ...ChatSessionRecords.create({
    id: 'session-1',
    name: 'Adapter authoring',
    workspaceId: 'workspace-1',
  }),
  createdAt: '2026-07-17T01:00:00.000Z',
  updatedAt: '2026-07-17T02:00:00.000Z',
  history: [
    { role: 'user' as const, content: 'Persist this record.' },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'call-1', tool: 'inspect', input: {} }],
      providerContinuation: {
        provider: 'kimi' as const,
        reasoningContent: 'Private continuation for exact Kimi replay.',
      },
    },
  ],
  messages: [{ id: 'message-1', role: 'user' as const, text: 'Persist this record.' }],
  turns: [{
    id: 'turn-1',
    prompt: 'Persist this record.',
    outcome: 'done',
    summary: 'Persisted the record.',
    steps: 1,
    traceFile: '/var/lib/agent/traces/turn-1.json',
    events: ['completed'],
  }],
});

describe('chat session adapter-authoring primitives', () => {
  it('strictly round-trips a complete opaque session record', () => {
    const record = createSessionRecord();

    expect(ChatSessionPersistenceCodec.parseRecord(record)).toEqual(record);
  });

  it.each([
    ['invalid model history', (record: ReturnType<typeof createSessionRecord>) => ({
      ...record,
      history: [{ role: 'assistant', content: 42 }],
    })],
    ['invalid context metadata', (record: ReturnType<typeof createSessionRecord>) => ({
      ...record,
      context: { estimatedHistoryTokens: '42' },
    })],
    ['missing queue state', (record: ReturnType<typeof createSessionRecord>) => {
      const { queuedPrompts: _queuedPrompts, ...withoutQueue } = record;
      return withoutQueue;
    }],
    ['unknown top-level state', (record: ReturnType<typeof createSessionRecord>) => ({
      ...record,
      undocumentedState: true,
    })],
  ])('rejects %s instead of degrading it', (_name, mutate) => {
    expect(() => ChatSessionPersistenceCodec.parseRecord(mutate(createSessionRecord()))).toThrow();
  });

  it('projects only catalog-safe fields and validates the revision', () => {
    const entry = ChatSessionPersistenceCodec.projectCatalogEntry(createSessionRecord(), 3);

    expect(entry).toMatchObject({
      id: 'session-1',
      revision: 3,
      name: 'Adapter authoring',
      workspaceId: 'workspace-1',
      pinned: false,
      updatedAt: '2026-07-17T02:00:00.000Z',
    });
    expect(entry).not.toHaveProperty('history');
    expect(entry).not.toHaveProperty('messages');
    expect(entry).not.toHaveProperty('turns');
    expect(entry).not.toHaveProperty('queuedPrompts');
    expect(() => ChatSessionPersistenceCodec.projectCatalogEntry(createSessionRecord(), 0)).toThrow();
  });

  it('uses one stable order for pinned groups, timestamps, and tied ids', () => {
    const entries = [
      { id: 'regular-new', pinned: false, updatedAt: '2026-07-17T03:00:00.000Z' },
      { id: 'a', pinned: true, updatedAt: '2026-07-17T02:00:00.000Z' },
      { id: 'Z', pinned: true, updatedAt: '2026-07-17T02:00:00.000Z' },
      { id: 'regular-old', pinned: false, updatedAt: '2026-07-17T01:00:00.000Z' },
    ].sort(ChatSessionCatalogPagination.compare);

    expect(entries.map((entry) => entry.id)).toEqual(['Z', 'a', 'regular-new', 'regular-old']);
    expect(ChatSessionCatalogPagination.isAfterCursor(entries[2]!, entries[1]!)).toBe(true);
    expect(ChatSessionCatalogPagination.isAfterCursor(entries[0]!, entries[1]!)).toBe(false);
  });

  it('matches UTF-8 binary database collation for non-ASCII tied ids', () => {
    const privateUse = { id: '\uE000', pinned: false, updatedAt: '2026-07-17T01:00:00.000Z' };
    const emoji = { id: '😀', pinned: false, updatedAt: '2026-07-17T01:00:00.000Z' };

    expect(ChatSessionCatalogPagination.compare(privateUse, emoji)).toBeLessThan(0);
    expect([emoji, privateUse].sort(ChatSessionCatalogPagination.compare)).toEqual([
      privateUse,
      emoji,
    ]);
  });

  it('round-trips opaque cursors and rejects malformed cursor state', () => {
    const entry = ChatSessionPersistenceCodec.projectCatalogEntry(createSessionRecord(), 3);
    const cursor = ChatSessionCatalogPagination.encodeCursor(entry);

    expect(ChatSessionCatalogPagination.decodeCursor(cursor)).toEqual({
      id: entry.id,
      pinned: entry.pinned,
      updatedAt: entry.updatedAt,
    });
    expect(() => ChatSessionCatalogPagination.decodeCursor('not-a-cursor'))
      .toThrow(InvalidChatSessionCursorError);

    const unexpectedField = Buffer.from(JSON.stringify({
      id: entry.id,
      pinned: entry.pinned,
      updatedAt: entry.updatedAt,
      tenantId: 'must-not-enter-the-generic-cursor',
    }), 'utf8').toString('base64url');
    expect(() => ChatSessionCatalogPagination.decodeCursor(unexpectedField))
      .toThrow(InvalidChatSessionCursorError);
  });

  it.each([0, 201, 1.5, Number.NaN])('rejects invalid page limit %s', (limit) => {
    expect(() => ChatSessionCatalogPagination.validatePageLimit(limit)).toThrow(RangeError);
  });

  it.each([1, 200])('accepts supported page limit %s', (limit) => {
    expect(() => ChatSessionCatalogPagination.validatePageLimit(limit)).not.toThrow();
  });
});
