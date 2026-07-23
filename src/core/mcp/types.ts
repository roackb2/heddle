import type { ToolPolicyEnvironment } from '@/core/tools/policy-envelope/types.js';

export type McpTransportKind = 'stdio' | 'http' | 'sse';

export type McpServerConfigSource = 'heddle' | 'standard' | 'vscode';

export type McpToolApprovalMode = 'always' | 'never';

export type McpToolPolicy = {
  allow?: string[];
  deny?: string[];
  approval?: McpToolApprovalMode;
};

export type McpStdioServerConfig = {
  id: string;
  transport: 'stdio';
  source: McpServerConfigSource;
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  envFile?: string;
  environment?: ToolPolicyEnvironment;
  tools?: McpToolPolicy;
};

export type McpHttpServerConfig = {
  id: string;
  transport: 'http' | 'sse';
  source: McpServerConfigSource;
  url: string;
  headers: Record<string, string>;
  environment?: ToolPolicyEnvironment;
  tools?: McpToolPolicy;
};

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export type McpConfigIssueCode =
  | 'config_missing'
  | 'config_invalid'
  | 'server_invalid'
  | 'duplicate_tool_name'
  | 'unsupported_transport';

export type McpConfigIssue = {
  code: McpConfigIssueCode;
  path: string;
  message: string;
};

export type McpConfigLoadResult = {
  configPath: string;
  servers: McpServerConfig[];
  issues: McpConfigIssue[];
};

export type McpConfigDocument = {
  configPath: string;
  content: string;
  exists: boolean;
  issues: McpConfigIssue[];
};

export type McpConfigSaveResult =
  | {
      ok: true;
      document: McpConfigDocument;
      overview: McpOverview;
    }
  | {
      ok: false;
      configPath: string;
      error: string;
    };

export type McpOpenConfigResult =
  | {
      ok: true;
      configPath: string;
      command: string;
    }
  | {
      ok: false;
      configPath: string;
      error: string;
    };

export type McpServerActivationStatus = 'enabled' | 'disabled';

export type McpServerActivationRecord = {
  serverId: string;
  status: McpServerActivationStatus;
  activatedAt: string;
  updatedAt: string;
};

export type McpActivationStore = {
  version: 1;
  servers: Record<string, McpServerActivationRecord>;
};

export type McpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type McpServerCatalogRecord = {
  serverId: string;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  tools: McpToolDescriptor[];
  refreshedAt: string;
};

export type McpCatalogStore = {
  version: 1;
  servers: Record<string, McpServerCatalogRecord>;
};

export type McpServerViewStatus =
  | 'enabled'
  | 'available'
  | 'disabled'
  | 'missing'
  | 'failed';

export type McpServerView = {
  id: string;
  status: McpServerViewStatus;
  config?: McpServerConfig;
  record?: McpServerActivationRecord;
  catalog?: McpServerCatalogRecord;
  toolCount: number;
  action: string;
};

export type McpOverview = {
  configPath: string;
  activationStorePath: string;
  catalogStorePath: string;
  servers: McpServerView[];
  issues: McpConfigIssue[];
};

export type McpActivationResult =
  | {
      ok: true;
      record: McpServerActivationRecord;
    }
  | {
      ok: false;
      reason: 'server_not_found' | 'server_not_enabled';
      serverId: string;
    };

export type McpRefreshResult =
  | {
      ok: true;
      record: McpServerCatalogRecord;
    }
  | {
      ok: false;
      reason: 'server_not_found' | 'server_not_enabled' | 'connection_failed';
      serverId: string;
      error: string;
    };

export type McpCallToolResult =
  | {
      ok: true;
      output: unknown;
    }
  | {
      ok: false;
      error: string;
    };

export type McpConfigStorePort = {
  read(): McpConfigLoadResult;
  ensureDocument(): McpConfigDocument;
  readDocument(): McpConfigDocument;
  writeDocument(content: string): McpConfigDocument;
};

export type McpActivationStorePort = {
  read(): McpActivationStore;
  write(store: McpActivationStore): void;
};

export type McpCatalogStorePort = {
  read(): McpCatalogStore;
  write(store: McpCatalogStore): void;
};

export type McpServiceOptions = {
  workspaceRoot: string;
  stateRoot: string;
  configStore?: McpConfigStorePort;
  activationStore?: McpActivationStorePort;
  catalogStore?: McpCatalogStorePort;
};

export type McpClientSessionInfo = {
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  tools: McpToolDescriptor[];
};
