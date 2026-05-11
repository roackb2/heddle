export type AwarenessDomain = 'coding';

export type AwarenessProfile =
  | 'working_environment'
  | 'bounded_file_tree'
  | 'project_dashboard';

export type AwarenessSourceKind =
  | 'filesystem'
  | 'git'
  | 'package_metadata'
  | 'workspace_catalog'
  | 'runtime_config';

export type AwarenessSource = {
  kind: AwarenessSourceKind;
  command?: string;
  path?: string;
  note?: string;
};

export type AwarenessLimitKind =
  | 'truncated'
  | 'unavailable'
  | 'omitted'
  | 'permission'
  | 'not_applicable';

export type AwarenessLimit = {
  kind: AwarenessLimitKind;
  subject: string;
  detail: string;
};

export type AwarenessSnapshot<Section = unknown> = {
  id: string;
  domain: AwarenessDomain;
  profile: AwarenessProfile;
  collectedAt: string;
  workspaceRoot: string;
  sections: Section[];
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
};

export type AwarenessCollectInput = {
  workspaceRoot: string;
  stateRoot?: string;
  profile: AwarenessProfile;
  maxDepth?: number;
  maxEntries?: number;
};

export type AwarenessProvider<Section = unknown> = {
  domain: AwarenessDomain;
  collect(input: AwarenessCollectInput): Promise<AwarenessSnapshot<Section>>;
};
