import type { ChatSession } from '../../../chat/types.js';
import type { AutonomyPermissionMode } from '../../../approvals/index.js';
import type { LlmProvider, ReasoningEffort } from '../../../llm/types.js';
import type { ProviderCredentialSource } from '../../../runtime/credentials/index.js';
import type {
  HeartbeatTask,
  HeartbeatTaskRunRecordEntry,
} from '@/core/heartbeat/index.js';
import type {
  AgentSkillActivationResult,
  AgentSkillActivationView,
} from '@/core/skills/index.js';
import type {
  McpActivationResult,
  McpOverview,
  McpRefreshResult,
} from '@/core/mcp/index.js';
import type { SlashCommandResult } from '../result-types.js';

export type SlashCommandExecutionContext = {
  model: {
    active: () => string;
    setActive: (model: string) => void;
    activeReasoningEffort: () => ReasoningEffort | undefined;
    setReasoningEffort: (effort: ReasoningEffort | undefined) => void;
    credentialSource: () => ProviderCredentialSource | undefined;
  };
  auth: {
    status: () => string;
    login: (provider: LlmProvider) => Promise<string>;
    logout: (provider: LlmProvider) => string;
  };
  compaction: {
    compactActive: () => Promise<string> | string;
  };
  drift: {
    status: () => { enabled: boolean; error?: string };
    setEnabled: (enabled: boolean) => void;
  };
  permissions: {
    current: () => AutonomyPermissionMode;
    set: (mode: AutonomyPermissionMode) => AutonomyPermissionMode;
  };
  session: {
    all: () => ChatSession[];
    recent: () => ChatSession[];
    recentListMessage: () => string[];
    create: (name?: string) => ChatSession;
    switch: (id: string) => void;
    rename: (name: string) => void;
    remove: (id: string) => void;
    clear: () => void;
    summarize: (session: ChatSession) => string;
  };
  heartbeat: {
    listTasks: () => Promise<HeartbeatTask[]>;
    listRunRecords: (options?: { taskId?: string; limit?: number }) => Promise<HeartbeatTaskRunRecordEntry[]>;
    loadRunRecord: (id: string) => Promise<HeartbeatTaskRunRecordEntry | undefined>;
  };
  skills: {
    list: () => Promise<AgentSkillActivationView[]>;
    activate: (name: string) => Promise<AgentSkillActivationResult>;
    disable: (name: string) => Promise<AgentSkillActivationResult>;
  };
  mcp: {
    list: () => Promise<McpOverview>;
    enable: (serverId: string) => Promise<McpActivationResult>;
    disable: (serverId: string) => Promise<McpActivationResult>;
    refresh: (serverId: string) => Promise<McpRefreshResult>;
  };
  help: {
    message: () => string;
  };
};

export type { SlashCommandResult };
