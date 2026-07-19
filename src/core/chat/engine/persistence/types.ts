import type { ChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import type { ChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';

/**
 * Complete persistence boundary for one conversation domain.
 *
 * Session records and compacted archives have different storage contracts but
 * must be configured together for a truthful completed-conversation promise.
 */
export type ConversationPersistence = {
  sessions: ChatSessionRepository;
  archives: ChatArchiveRepository;
};

/**
 * Discoverable persistence capabilities configured for a Heddle runtime.
 *
 * Future domains may add their own capability without sharing a CRUD contract
 * with conversations. This map is composition, not a universal storage port.
 */
export type HeddlePersistenceCapabilities = {
  conversations?: ConversationPersistence;
};

export type ConversationPersistenceConfiguration = {
  persistence?: HeddlePersistenceCapabilities;
  /** Compatibility input for Heddle 5.1 and earlier hosts. */
  sessionRepository?: ChatSessionRepository;
  /** Compatibility input for Heddle 5.1 and earlier hosts. */
  archiveRepository?: ChatArchiveRepository;
};

export type ConversationPersistenceReadinessSource =
  | 'default-files'
  | 'conversation-capability'
  | 'legacy-repositories';

export type ConversationPersistenceTargetLevel =
  | 'local'
  | 'completed-conversation';

export type ConversationPersistenceReadinessIssueCode =
  | 'legacy-repository-options'
  | 'session-repository-missing'
  | 'archive-repository-missing';

export type ConversationPersistenceReadinessIssue = {
  code: ConversationPersistenceReadinessIssueCode;
  severity: 'warning' | 'error';
  message: string;
};

export type ConversationPersistenceReadinessCheckId =
  | 'persistent-state-root'
  | 'backup-and-restore'
  | 'same-authenticated-scope'
  | 'session-revision-conflicts'
  | 'atomic-archive-append'
  | 'fresh-instance-compaction-recovery'
  | 'identity-isolation-and-deletion'
  | 'product-finalization-before-success';

export type ConversationPersistenceReadinessCheck = {
  id: ConversationPersistenceReadinessCheckId;
  description: string;
};

/**
 * Configuration evidence only—not a database, auth, or disaster-recovery
 * certification. `configurationComplete` confirms that the selected Heddle
 * domain boundary is present; the host checks still require real deployment
 * evidence.
 */
export type ConversationPersistenceReadinessReport = {
  source: ConversationPersistenceReadinessSource;
  targetLevel: ConversationPersistenceTargetLevel;
  configurationComplete: boolean;
  issues: ConversationPersistenceReadinessIssue[];
  requiredHostChecks: ConversationPersistenceReadinessCheck[];
};

export type ResolvedConversationPersistence = ConversationPersistence & {
  readiness: ConversationPersistenceReadinessReport;
};

export type ResolvedHeddlePersistenceCapabilities = {
  conversations: ResolvedConversationPersistence;
};
