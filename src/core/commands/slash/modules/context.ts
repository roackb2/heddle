import type { ChatSession, LocalCommandResult } from '../../../chat/types.js';
import type { LlmProvider } from '../../../llm/types.js';
import type { ProviderCredentialSource } from '../../../runtime/api-keys.js';
import type {
  HeartbeatTask,
  HeartbeatTaskRunRecordEntry,
} from '../../../runtime/heartbeat-task-store.js';

export type SlashCommandExecutionContext = {
  model: {
    active: () => string;
    setActive: (model: string) => void;
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
};

export type CoreSlashCommandResult = LocalCommandResult;
