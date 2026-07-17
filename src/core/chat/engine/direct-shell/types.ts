import type { ConversationActivity, ConversationCompactionStatus } from '@/core/live/index.js';
import type { ProviderCredentialSource } from '@/core/runtime/credentials/index.js';
import type { ConversationDirectShellLineResult } from '@/core/chat/types.js';
import type { ConversationSessionService } from '../types.js';
import type { ChatArchiveRepository } from '../sessions/archives/index.js';

export type DirectShellToolName = 'run_shell_inspect' | 'run_shell_mutate';

export type ConversationDirectShellPreflightRisk = 'safe' | 'confirmRequired' | 'blocked';

export type ConversationDirectShellPreflight = {
  command: string;
  risk: ConversationDirectShellPreflightRisk;
  tool?: DirectShellToolName;
  reason?: string;
};

export type ConversationDirectShellInput = {
  sessionId: string;
  runId: string;
  command: string;
  riskAccepted?: boolean;
  model: string;
  workspaceRoot: string;
  stateRoot: string;
  archiveRepository?: ChatArchiveRepository;
  systemContext?: string;
  credentialSource?: ProviderCredentialSource;
  sessions: ConversationSessionService;
  abortSignal?: AbortSignal;
  onActivity?: (activity: ConversationActivity) => void;
  onCompactionStatus?: (activity: ConversationCompactionStatus) => void;
};

export type ConversationDirectShellResult = {
  outcome: 'done' | 'confirmation_required' | 'blocked' | 'error';
  summary: string;
  command: string;
  shellDisplay: string;
  tool?: DirectShellToolName;
  result?: ConversationDirectShellLineResult;
};
