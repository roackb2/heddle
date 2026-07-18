import { FileChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import type {
  ConversationPersistence,
  ConversationPersistenceConfiguration,
  ConversationPersistenceReadinessCheck,
  ConversationPersistenceReadinessIssue,
  ConversationPersistenceReadinessReport,
  ResolvedHeddlePersistenceCapabilities,
} from './types.js';

const LOCAL_HOST_CHECKS: ConversationPersistenceReadinessCheck[] = [
  {
    id: 'persistent-state-root',
    description: 'Keep stateRoot on a persistent local filesystem with normal locking and atomic rename semantics.',
  },
  {
    id: 'backup-and-restore',
    description: 'Verify backup and restore for the complete local stateRoot before relying on it as user-owned durable state.',
  },
];

const COMPLETED_CONVERSATION_HOST_CHECKS: ConversationPersistenceReadinessCheck[] = [
  {
    id: 'same-authenticated-scope',
    description: 'Construct both repositories from the same trusted server-side identity scope.',
  },
  {
    id: 'session-revision-conflicts',
    description: 'Verify that concurrent session writers cannot silently overwrite a newer revision.',
  },
  {
    id: 'atomic-archive-append',
    description: 'Verify that archive content, rolling summary, and manifest become visible atomically.',
  },
  {
    id: 'fresh-instance-compaction-recovery',
    description: 'Force compaction and continue from the recovered session and rolling summary in a fresh process or replica.',
  },
  {
    id: 'identity-isolation-and-deletion',
    description: 'Verify cross-identity isolation plus documented deletion, retention, migration, and backup behavior.',
  },
  {
    id: 'product-finalization-before-success',
    description: 'Commit any host-owned canonical result before publishing terminal success.',
  },
];

type ResolveConversationPersistenceInput = ConversationPersistenceConfiguration & {
  sessionStoragePath: string;
  stateRoot: string;
};

/**
 * Owns conversation persistence capability validation, compatibility
 * resolution, local defaults, and non-certifying readiness evidence.
 */
export class ConversationPersistenceService {
  static assess(
    configuration: ConversationPersistenceConfiguration = {},
  ): ConversationPersistenceReadinessReport {
    const conversations = configuration.persistence?.conversations;
    ConversationPersistenceService.assertValidCapability(conversations);
    ConversationPersistenceService.assertUnambiguousConfiguration(configuration);

    if (conversations) {
      return {
        source: 'conversation-capability',
        targetLevel: 'completed-conversation',
        configurationComplete: true,
        issues: [],
        requiredHostChecks: ConversationPersistenceService.cloneChecks(
          COMPLETED_CONVERSATION_HOST_CHECKS,
        ),
      };
    }

    const hasSessionRepository = Boolean(configuration.sessionRepository);
    const hasArchiveRepository = Boolean(configuration.archiveRepository);
    if (!hasSessionRepository && !hasArchiveRepository) {
      return {
        source: 'default-files',
        targetLevel: 'local',
        configurationComplete: true,
        issues: [],
        requiredHostChecks: ConversationPersistenceService.cloneChecks(LOCAL_HOST_CHECKS),
      };
    }

    return {
      source: 'legacy-repositories',
      targetLevel: 'completed-conversation',
      configurationComplete: hasSessionRepository && hasArchiveRepository,
      issues: ConversationPersistenceService.legacyIssues({
        hasArchiveRepository,
        hasSessionRepository,
      }),
      requiredHostChecks: ConversationPersistenceService.cloneChecks(
        COMPLETED_CONVERSATION_HOST_CHECKS,
      ),
    };
  }

  static resolve(
    input: ResolveConversationPersistenceInput,
  ): ResolvedHeddlePersistenceCapabilities {
    const readiness = ConversationPersistenceService.assess(input);
    const conversations = input.persistence?.conversations
      ?? ConversationPersistenceService.resolveCompatibilityRepositories(input);

    return {
      conversations: {
        ...conversations,
        readiness,
      },
    };
  }

  private static legacyIssues(args: {
    hasArchiveRepository: boolean;
    hasSessionRepository: boolean;
  }): ConversationPersistenceReadinessIssue[] {
    return [
      {
        code: 'legacy-repository-options',
        severity: 'warning',
        message: 'Configure persistence.conversations for new hosts; separate repository options remain for compatibility.',
      },
      ...(!args.hasSessionRepository ? [{
        code: 'session-repository-missing' as const,
        severity: 'error' as const,
        message: 'A custom archive repository without its paired session repository cannot support completed-conversation durability.',
      }] : []),
      ...(!args.hasArchiveRepository ? [{
        code: 'archive-repository-missing' as const,
        severity: 'error' as const,
        message: 'A custom session repository without its paired archive repository cannot support completed-conversation durability after compaction.',
      }] : []),
    ];
  }

  private static resolveCompatibilityRepositories(
    input: ResolveConversationPersistenceInput,
  ): ConversationPersistence {
    return {
      sessions: input.sessionRepository ?? new FileChatSessionRepository({
        sessionStoragePath: input.sessionStoragePath,
      }),
      archives: input.archiveRepository ?? new FileChatArchiveRepository({
        stateRoot: input.stateRoot,
      }),
    };
  }

  private static assertValidCapability(
    conversations: ConversationPersistence | undefined,
  ): void {
    if (!conversations) {
      return;
    }

    if (!conversations.sessions || !conversations.archives) {
      throw new Error('persistence.conversations requires both sessions and archives repositories.');
    }
  }

  private static assertUnambiguousConfiguration(
    configuration: ConversationPersistenceConfiguration,
  ): void {
    if (
      configuration.persistence?.conversations
      && (configuration.sessionRepository || configuration.archiveRepository)
    ) {
      throw new Error(
        'persistence.conversations cannot be combined with the deprecated sessionRepository or archiveRepository options.',
      );
    }
  }

  private static cloneChecks(
    checks: ConversationPersistenceReadinessCheck[],
  ): ConversationPersistenceReadinessCheck[] {
    return checks.map((check) => ({ ...check }));
  }
}
