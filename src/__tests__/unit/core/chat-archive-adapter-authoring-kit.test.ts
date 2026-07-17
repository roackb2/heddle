import { describe, expect, it } from 'vitest';
import { ChatArchivePersistenceCodec } from '../../../index.js';

describe('chat archive adapter-authoring primitives', () => {
  it('builds and strictly round-trips a canonical manifest', () => {
    const empty = ChatArchivePersistenceCodec.emptyManifest('session-1');
    const manifest = ChatArchivePersistenceCodec.appendArchive(empty, {
      id: 'archive-1',
      path: 'db://conversation-archives/archive-1/messages',
      summaryPath: 'db://conversation-archives/archive-1/summary',
      messageCount: 3,
      createdAt: '2026-07-17T00:00:00.000Z',
      summaryModel: 'gpt-5.4',
    });

    expect(ChatArchivePersistenceCodec.parseManifest(
      JSON.parse(ChatArchivePersistenceCodec.serializeManifest(manifest)) as unknown,
      'session-1',
    )).toEqual(manifest);
  });

  it('rejects session mismatches, unknown manifest state, and duplicate archive ids', () => {
    const empty = ChatArchivePersistenceCodec.emptyManifest('session-1');
    const archive = {
      id: 'archive-1',
      path: 'db://conversation-archives/archive-1/messages',
      summaryPath: 'db://conversation-archives/archive-1/summary',
      messageCount: 3,
      createdAt: '2026-07-17T00:00:00.000Z',
    };
    const manifest = ChatArchivePersistenceCodec.appendArchive(empty, archive);

    expect(() => ChatArchivePersistenceCodec.parseManifest(manifest, 'session-2'))
      .toThrow('archive manifest session mismatch');
    expect(() => ChatArchivePersistenceCodec.parseManifest({
      ...manifest,
      tenantId: 'scope-must-stay-in-the-host-adapter',
    }, 'session-1')).toThrow();
    expect(() => ChatArchivePersistenceCodec.appendArchive(manifest, archive))
      .toThrow('conversation archive already exists');
  });
});
