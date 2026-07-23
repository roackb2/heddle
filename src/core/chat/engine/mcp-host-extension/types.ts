import type { ArtifactKind, RuntimeArtifact } from '@/core/artifacts/index.js';
import type { McpRefreshResult, McpServerCatalogRecord, McpServerConfig, McpToolDescriptor } from '@/core/mcp/index.js';
import type { ToolPolicyEnvironment, ToolPolicyOperation, ToolToolkitContext } from '@/core/tools/index.js';
import type {
  ConversationEngineHostArtifactOptions,
  ConversationEngineHostExtension,
} from '../host-extension.js';

export type McpHostToolOverride = {
  name?: string;
  description?: string;
  capabilities?: string[];
  requiresApproval?: boolean;
  /**
   * Host-owned effect classification. Omit when the host cannot verify the
   * remote tool's effects; model claims remain proposals.
   */
  operations?: readonly ToolPolicyOperation[];
};

export type McpHostResultArtifactRule = {
  /** Original MCP tool name from the cached catalog, before host renaming. */
  toolName: string;
  /** Path inside the MCP result output that should be persisted as an artifact. */
  path: string | readonly string[];
  /**
   * How the captured value is returned to the model.
   *
   * - `'replace'` (default): swap the value for a compact artifact reference —
   *   the context-compaction behavior.
   * - `'mirror'`: persist the artifact but leave the value inline and
   *   untouched. Use when downstream tool calls need the full value as input
   *   (e.g. stateless MCP servers that take the current document as an
   *   argument) while the host still wants a durable artifact — typically with
   *   `setCurrent: true` so the host reads the outcome via
   *   `engine.artifacts.current(...)`. `replacePaths` is ignored in this mode.
   */
  mode?: 'replace' | 'mirror';
  /** Additional output paths to replace with the same artifact reference. */
  replacePaths?: ReadonlyArray<string | readonly string[]>;
  kind: ArtifactKind;
  domain?: string;
  title?: string;
  extension?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  setCurrent?: boolean;
  maxPreviewChars?: number;
};

export type McpHostAutoResultArtifactHint = {
  path?: string | readonly string[];
  pathIncludes?: string | readonly string[];
  kind?: ArtifactKind;
  domain?: string;
  title?: string;
  extension?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  setCurrent?: boolean;
  maxPreviewChars?: number;
};

export type McpHostAutoResultArtifactsOptions = {
  minChars?: number;
  replaceDuplicateContent?: boolean;
  kind?: ArtifactKind;
  domain?: string;
  extension?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  setCurrent?: boolean;
  maxPreviewChars?: number;
  hints?: readonly McpHostAutoResultArtifactHint[];
};

export type McpHostResultArtifactsOptions =
  | boolean
  | readonly McpHostResultArtifactRule[]
  | {
      auto?: boolean | McpHostAutoResultArtifactsOptions;
      rules?: readonly McpHostResultArtifactRule[];
    };

export type McpHostResultArtifactReference = RuntimeArtifact & {
  relativePath: string;
};

export type McpHostResultArtifactOutput = {
  artifact: McpHostResultArtifactReference;
  contentPath: string[];
  preview: string;
  omittedCharacters: number;
};

export type DefineMcpHostExtensionOptions = {
  id: string;
  serverId: string;
  includeTools?: string[];
  excludeTools?: string[];
  /** Prefix exposed tool names only when multiple MCP servers may collide. */
  toolNamePrefix?: string;
  defaultCapabilities?: string[];
  /** Host-owned target environment. Overrides config/endpoint derivation. */
  environment?: ToolPolicyEnvironment;
  /** Optional opaque tenant boundary recorded in policy evaluation traces. */
  tenantId?: string;
  toolOverrides?: Record<string, McpHostToolOverride>;
  hideDefaultMcpTools?: boolean;
  resultArtifacts?: McpHostResultArtifactsOptions;
  systemContext?: string;
  artifacts?: ConversationEngineHostArtifactOptions;
};

export type PrepareMcpHostExtensionCatalogOptions = {
  workspaceRoot: string;
  stateRoot: string;
  serverId: string;
  server: Record<string, unknown>;
};

export type PrepareMcpHostExtensionOptions = DefineMcpHostExtensionOptions & {
  workspaceRoot: string;
  stateRoot: string;
  server: Record<string, unknown>;
};

export type PrepareMcpHostExtensionCatalogResult =
  | {
      ok: true;
      serverId: string;
      refresh: Extract<McpRefreshResult, { ok: true }>;
      /** Normalized server config from the just-saved MCP config, so the prepared
       *  extension can execute tools without re-reading `stateRoot` at runtime. */
      resolvedServer: McpServerConfig;
      toolNames: string[];
    }
  | {
      ok: false;
      serverId: string;
      step: 'save_config' | 'activate_server' | 'refresh_catalog';
      error: string;
    };

export type PrepareMcpHostExtensionResult =
  | (Extract<PrepareMcpHostExtensionCatalogResult, { ok: true }> & {
      extension: ConversationEngineHostExtension;
    })
  | Extract<PrepareMcpHostExtensionCatalogResult, { ok: false }>;

export type ResolvedMcpTool = {
  server: McpServerConfig;
  tool: McpToolDescriptor;
};

/**
 * Self-contained MCP state embedded into a prepared host extension. When
 * present, the toolkit resolves and executes tools from this data instead of
 * re-reading the MCP config/catalog from `context.stateRoot` at runtime. This is
 * what lets one prepared extension be reused across cheap, per-request engines
 * (e.g. a multi-tenant server) without per-engine MCP prep.
 */
export type ResolvedMcpHostExtensionData = {
  server: McpServerConfig;
  catalog: McpServerCatalogRecord;
};

export type ResolvedResultArtifactsOptions = {
  auto?: McpHostAutoResultArtifactsOptions;
  rules: readonly McpHostResultArtifactRule[];
};

export type ResultArtifactCandidate = {
  content: string;
  path: string[];
};

export type McpResultArtifactApplyInput = {
  context: ToolToolkitContext;
  options: DefineMcpHostExtensionOptions;
  output: unknown;
  sourceTool: string;
  toolName: string;
};

export type McpManualResultArtifactApplyInput = McpResultArtifactApplyInput & {
  rule: McpHostResultArtifactRule;
};

export type McpAutoResultArtifactApplyInput = McpResultArtifactApplyInput & {
  auto: McpHostAutoResultArtifactsOptions;
  excludedPaths?: ReadonlyArray<readonly string[]>;
};
