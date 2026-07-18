import { describe, expect, it } from 'vitest';
import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import {
  ConversationPersistenceService,
} from '@/core/chat/engine/persistence/index.js';

describe('ConversationPersistenceService', () => {
  it('describes the default file capability as a complete local configuration', () => {
    expect(ConversationPersistenceService.assess()).toEqual({
      source: 'default-files',
      targetLevel: 'local',
      configurationComplete: true,
      issues: [],
      requiredHostChecks: [
        expect.objectContaining({ id: 'persistent-state-root' }),
        expect.objectContaining({ id: 'backup-and-restore' }),
      ],
    });
  });

  it('describes a complete conversation capability without certifying the host', () => {
    const readiness = ConversationPersistenceService.assess({
      persistence: {
        conversations: {
          sessions: createSessionRepository(),
          archives: createArchiveRepository(),
        },
      },
    });

    expect(readiness).toEqual(expect.objectContaining({
      source: 'conversation-capability',
      targetLevel: 'completed-conversation',
      configurationComplete: true,
      issues: [],
    }));
    expect(readiness.requiredHostChecks.map((check) => check.id)).toEqual([
      'same-authenticated-scope',
      'session-revision-conflicts',
      'atomic-archive-append',
      'fresh-instance-compaction-recovery',
      'identity-isolation-and-deletion',
      'product-finalization-before-success',
    ]);
  });

  it('reports a partial legacy configuration without breaking compatibility', () => {
    const readiness = ConversationPersistenceService.assess({
      sessionRepository: createSessionRepository(),
    });

    expect(readiness).toEqual(expect.objectContaining({
      source: 'legacy-repositories',
      targetLevel: 'completed-conversation',
      configurationComplete: false,
    }));
    expect(readiness.issues).toEqual([
      expect.objectContaining({
        code: 'legacy-repository-options',
        severity: 'warning',
      }),
      expect.objectContaining({
        code: 'archive-repository-missing',
        severity: 'error',
      }),
    ]);
  });

  it('rejects mixing the coherent capability with legacy repository options', () => {
    const sessions = createSessionRepository();
    const archives = createArchiveRepository();

    expect(() => ConversationPersistenceService.assess({
      persistence: {
        conversations: { sessions, archives },
      },
      sessionRepository: sessions,
    })).toThrow(
      'persistence.conversations cannot be combined with the deprecated sessionRepository or archiveRepository options.',
    );
  });
});

function createSessionRepository(): ChatSessionRepository {
  return {
    list: async () => ({ items: [] }),
    read: async () => undefined,
    create: async (session) => ({ session, revision: 1 }),
    update: async () => undefined,
    delete: async () => false,
  };
}

function createArchiveRepository(): ChatArchiveRepository {
  return {
    loadManifest: async (sessionId) => ({ version: 1, sessionId, archives: [] }),
    readSummary: async () => undefined,
    append: async () => {
      throw new Error('Not used by readiness assessment.');
    },
  };
}
