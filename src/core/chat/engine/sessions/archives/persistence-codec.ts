import type { ChatArchiveManifest, ChatArchiveRecord } from '@/core/chat/types.js';
import { ChatArchiveManifestSchema } from './schemas.js';

/**
 * Strict database-neutral validation and manifest projection for archive
 * repository adapters. File and remote adapters should share these invariants.
 */
export class ChatArchivePersistenceCodec {
  static emptyManifest(sessionId: string): ChatArchiveManifest {
    return ChatArchiveManifestSchema.parse({
      version: 1,
      sessionId,
      archives: [],
    });
  }

  static parseManifest(value: unknown, expectedSessionId: string): ChatArchiveManifest {
    const manifest = ChatArchiveManifestSchema.parse(value);
    if (manifest.sessionId !== expectedSessionId) {
      throw new Error(
        `archive manifest session mismatch: expected ${expectedSessionId}, found ${manifest.sessionId}`,
      );
    }
    return manifest;
  }

  static appendArchive(
    manifest: ChatArchiveManifest,
    archive: ChatArchiveRecord,
  ): ChatArchiveManifest {
    if (manifest.archives.some((candidate) => candidate.id === archive.id)) {
      throw new Error(`conversation archive already exists: ${archive.id}`);
    }

    return ChatArchiveManifestSchema.parse({
      version: 1,
      sessionId: manifest.sessionId,
      currentSummaryPath: archive.summaryPath,
      archives: [...manifest.archives, archive],
    });
  }

  static serializeManifest(manifest: ChatArchiveManifest): string {
    return `${JSON.stringify(ChatArchiveManifestSchema.parse(manifest), null, 2)}\n`;
  }
}
