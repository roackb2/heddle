export type AwarenessDomain = 'coding';

export type AwarenessProfile = 'working_environment';

export type AwarenessSource = {
  kind: 'filesystem' | 'git' | 'runtime_config';
  command?: string;
  path?: string;
  note?: string;
};

export type AwarenessLimit = {
  kind: 'truncated' | 'unavailable' | 'omitted' | 'permission' | 'not_applicable';
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
  domain: AwarenessDomain;
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
