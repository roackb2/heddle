import type { ReasoningEffort } from '@/core/llm/types.js';
import type { RuntimeToolSelectionProfile } from '@/core/runtime/tools/index.js';
import type { ToolApprovalProfile } from '@/core/approvals/index.js';

export type CustomAgentSourceKind = 'project' | 'user' | 'built-in';

export type CustomAgentModeAlias = 'ask' | 'code' | 'review';

export type CustomAgentRuntimeDefaults = {
  maxSteps?: number;
  model?: string;
  reasoningEffort?: ReasoningEffort;
};

export type CustomAgentDefinition = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  source: CustomAgentSourceKind;
  definitionPath?: string;
  modeAlias?: CustomAgentModeAlias;
  runtime: CustomAgentRuntimeDefaults;
  tools: RuntimeToolSelectionProfile;
  approval: ToolApprovalProfile;
  promptAppendix: string;
};

export type CustomAgentCatalogIssue = {
  severity: 'warning' | 'error';
  source: CustomAgentSourceKind;
  path?: string;
  message: string;
};

export type CustomAgentCatalog = {
  agents: CustomAgentDefinition[];
  issues: CustomAgentCatalogIssue[];
};

export type CustomAgentExecutionSnapshot = {
  agentProfileId: string;
  agentName: string;
  modeAlias?: CustomAgentModeAlias;
  source: CustomAgentSourceKind;
  definitionHash: string;
  runtime: CustomAgentRuntimeDefaults;
  toolProfile: RuntimeToolSelectionProfile;
  approvalProfile: ToolApprovalProfile;
  systemContextAppendix: string;
};

export type CustomAgentOption = {
  id: string;
  name: string;
  description: string;
  modeAlias?: CustomAgentModeAlias;
  source: CustomAgentSourceKind;
};
