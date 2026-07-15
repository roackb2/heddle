import type { ChatSession } from '../../../chat/types.js';
import type { AutonomyPermissionMode } from '../../../approvals/index.js';
import type {
  BrowserAutomationNativeChromeLaunchInput,
  BrowserAutomationNativeChromeLaunchResult,
  BrowserAutomationNativeChromeStatus,
  BrowserAutomationOverview,
  BrowserAutomationProfileOpenInput,
  BrowserAutomationProfileWindowResult,
  BrowserAutomationSettingsUpdateInput,
  BrowserAutomationSettingsUpdateResult,
  BrowserAutomationSetEnabledResult,
} from '../../../browser/index.js';
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
  McpOpenConfigResult,
  McpRefreshResult,
} from '@/core/mcp/index.js';
import type { SlashCommandResult } from '../result-types.js';

export type SlashCommandExecutionContext = {
  model: {
    active: () => string;
    setActive: (model: string) => Promise<void>;
    activeReasoningEffort: () => ReasoningEffort | undefined;
    setReasoningEffort: (effort: ReasoningEffort | undefined) => Promise<void>;
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
    setEnabled: (enabled: boolean) => Promise<void>;
  };
  permissions: {
    current: () => AutonomyPermissionMode;
    set: (mode: AutonomyPermissionMode) => AutonomyPermissionMode;
  };
  session: {
    all: () => Promise<ChatSession[]>;
    recent: () => Promise<ChatSession[]>;
    recentListMessage: () => Promise<string[]>;
    create: (name?: string) => Promise<ChatSession>;
    switch: (id: string) => Promise<void>;
    rename: (name: string) => Promise<void>;
    setPinned: (pinned: boolean) => Promise<void>;
    remove: (id: string) => Promise<void>;
    clear: () => Promise<void>;
    summarize: (session: ChatSession) => string;
  };
  heartbeat: {
    listTasks: () => Promise<HeartbeatTask[]>;
    listRunRecords: (options?: { taskId?: string; limit?: number }) => Promise<HeartbeatTaskRunRecordEntry[]>;
    loadRunRecord: (id: string) => Promise<HeartbeatTaskRunRecordEntry | undefined>;
  };
  browserAutomation: {
    overview: () => Promise<BrowserAutomationOverview>;
    setEnabled: (enabled: boolean) => Promise<BrowserAutomationSetEnabledResult>;
    updateSettings: (input: BrowserAutomationSettingsUpdateInput) => Promise<BrowserAutomationSettingsUpdateResult>;
    openProfileWindow: (input?: BrowserAutomationProfileOpenInput) => Promise<BrowserAutomationProfileWindowResult>;
    closeProfileWindow: () => Promise<BrowserAutomationProfileWindowResult>;
    launchNativeChrome: (input?: BrowserAutomationNativeChromeLaunchInput) => Promise<BrowserAutomationNativeChromeLaunchResult>;
    nativeChromeStatus: () => Promise<BrowserAutomationNativeChromeStatus>;
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
    openConfig: () => Promise<McpOpenConfigResult>;
  };
  help: {
    message: () => string;
  };
};

export type { SlashCommandResult };
