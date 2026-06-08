import type { ResourceLink, SkillMetadataMap } from 'agent-skills-ts-sdk';

export type AgentSkillSourceKind = 'project' | 'user' | 'built-in';

export type AgentSkillRoot = {
  source: AgentSkillSourceKind;
  path: string;
};

export type AgentSkillCatalogEntry = {
  name: string;
  description: string;
  skillFilePath: string;
  skillRootPath: string;
  source: AgentSkillSourceKind;
  compatibility?: string;
  license?: string;
  allowedTools?: string;
  metadata?: SkillMetadataMap;
};

export type AgentSkillCatalogIssueCode =
  | 'duplicate_skill'
  | 'invalid_skill'
  | 'unreadable_skill'
  | 'unreadable_root';

export type AgentSkillCatalogIssue = {
  code: AgentSkillCatalogIssueCode;
  path: string;
  message: string;
};

export type AgentSkillCatalog = {
  skills: AgentSkillCatalogEntry[];
  issues: AgentSkillCatalogIssue[];
};

export type AgentSkillActivationStatus = 'active' | 'disabled';

export type AgentSkillActivationRecord = {
  name: string;
  source: AgentSkillSourceKind;
  skillFilePath: string;
  status: AgentSkillActivationStatus;
  activatedAt: string;
  updatedAt: string;
};

export type AgentSkillActivationStore = {
  version: 1;
  skills: Record<string, AgentSkillActivationRecord>;
};

export type AgentSkillActivationViewStatus =
  | AgentSkillActivationStatus
  | 'available'
  | 'missing';

export type AgentSkillActivationView = {
  name: string;
  status: AgentSkillActivationViewStatus;
  catalogEntry?: AgentSkillCatalogEntry;
  record?: AgentSkillActivationRecord;
};

export type AgentSkillActivationResult =
  | {
      ok: true;
      record: AgentSkillActivationRecord;
    }
  | {
      ok: false;
      reason: 'skill_not_found' | 'skill_not_active';
      name: string;
    };

export type AgentSkillActivationStoreOptions = {
  stateRoot: string;
};

export type AgentSkillActivationStorePort = {
  read(): AgentSkillActivationStore;
  write(store: AgentSkillActivationStore): void;
};

export type AgentSkillServiceOptions = {
  workspaceRoot: string;
  cwd?: string;
  homeDir?: string;
  builtInSkillRoots?: string[];
  activationStore?: AgentSkillActivationStorePort;
};

export type AgentSkillReadResult = {
  skill: AgentSkillCatalogEntry;
  body: string;
  resources: ResourceLink[];
};

export type AgentSkillCatalogPromptOptions = {
  readToolName?: string;
};
