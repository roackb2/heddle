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

export type AgentSkillServiceOptions = {
  workspaceRoot: string;
  cwd?: string;
  homeDir?: string;
  builtInSkillRoots?: string[];
};

export type AgentSkillReadResult = {
  skill: AgentSkillCatalogEntry;
  body: string;
  resources: ResourceLink[];
};

export type AgentSkillCatalogPromptOptions = {
  readToolName?: string;
};
