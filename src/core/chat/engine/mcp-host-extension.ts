import {
  McpService,
  isToolAllowed,
  shouldMcpToolRequireApproval,
} from '@/core/mcp/index.js';
import { ArtifactService } from '@/core/artifacts/index.js';
import type { McpRefreshResult, McpServerConfig, McpToolDescriptor } from '@/core/mcp/index.js';
import type { ArtifactKind, RuntimeArtifact } from '@/core/artifacts/index.js';
import type { ToolDefinition, ToolResult } from '@/core/types.js';
import type { ToolToolkit, ToolToolkitContext } from '@/core/tools/index.js';
import cloneDeep from 'lodash/cloneDeep.js';
import get from 'lodash/get.js';
import set from 'lodash/set.js';
import {
  defineHostExtension,
  type ConversationEngineHostArtifactOptions,
  type ConversationEngineHostExtension,
} from './host-extension.js';

export type McpHostToolOverride = {
  name?: string;
  description?: string;
  capabilities?: string[];
  requiresApproval?: boolean;
};

export type McpHostResultArtifactRule = {
  /** Original MCP tool name from the cached catalog, before host renaming. */
  toolName: string;
  /** Path inside the MCP result output that should be persisted as an artifact. */
  path: string | readonly string[];
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

type ResolvedMcpTool = {
  server: McpServerConfig;
  tool: McpToolDescriptor;
};

type ResolvedResultArtifactsOptions = {
  auto?: McpHostAutoResultArtifactsOptions;
  rules: readonly McpHostResultArtifactRule[];
};

type ResultArtifactCandidate = {
  content: string;
  path: string[];
};

/**
 * Builds host extensions from cached MCP tool descriptors without requiring
 * programmatic hosts to copy MCP schemas into hand-written ToolDefinitions.
 */
export class McpHostExtensionService {
  static define(options: DefineMcpHostExtensionOptions): ConversationEngineHostExtension {
    const toolkit = McpHostExtensionService.createToolkit(options);

    return defineHostExtension({
      id: options.id,
      toolkits: [toolkit],
      ...(options.systemContext ? { systemContext: options.systemContext } : {}),
      ...(options.artifacts ? { artifacts: options.artifacts } : {}),
      ...(options.hideDefaultMcpTools ? { mcp: { hideDefaultServers: [options.serverId] } } : {}),
    });
  }

  private static createToolkit(options: DefineMcpHostExtensionOptions): ToolToolkit {
    return {
      id: `mcp.${options.id}`,
      createTools(context) {
        return McpHostExtensionService.resolveTools({ context, options })
          .map(({ server, tool }) => McpHostExtensionService.createTool({
            context,
            options,
            server,
            tool,
          }));
      },
    };
  }

  private static resolveTools(args: {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
  }): ResolvedMcpTool[] {
    const mcp = McpHostExtensionService.createMcpService(args.context);
    const server = mcp.listOverview().servers.find((candidate) => candidate.id === args.options.serverId);
    if (server?.status !== 'enabled' || !server.config || !server.catalog) {
      return [];
    }

    const { config, catalog } = server;
    const include = args.options.includeTools ? new Set(args.options.includeTools) : undefined;
    const exclude = new Set(args.options.excludeTools ?? []);

    return catalog.tools
      .filter((tool) => (include ? include.has(tool.name) : true))
      .filter((tool) => !exclude.has(tool.name))
      .filter((tool) => isToolAllowed(config, tool.name))
      .map((tool) => ({
        server: config,
        tool,
      }));
  }

  private static createTool(args: {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
    server: McpServerConfig;
    tool: McpToolDescriptor;
  }): ToolDefinition {
    const override = args.options.toolOverrides?.[args.tool.name];
    const name = override?.name ?? McpHostExtensionService.toHostToolName(args.options, args.tool.name);

    return {
      name,
      requiresApproval: override?.requiresApproval ?? shouldMcpToolRequireApproval(args.server),
      description: override?.description ?? McpHostExtensionService.describeTool(args.options, args.tool),
      capabilities: override?.capabilities ?? args.options.defaultCapabilities ?? ['mcp.unknown'],
      parameters: args.tool.inputSchema,
      async execute(raw: unknown): Promise<ToolResult> {
        const result = await McpHostExtensionService.createMcpService(args.context)
          .callTool(args.options.serverId, args.tool.name, isRecord(raw) ? raw : {});

        return result.ok
          ? {
              ok: true,
              output: McpHostExtensionService.applyResultArtifactRules({
                context: args.context,
                options: args.options,
                output: result.output,
                sourceTool: name,
                toolName: args.tool.name,
              }),
            }
          : { ok: false, error: result.error };
      },
    };
  }

  private static applyResultArtifactRules(args: {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
    output: unknown;
    sourceTool: string;
    toolName: string;
  }): unknown {
    const resultArtifacts = McpHostExtensionService.resolveResultArtifacts(args.options.resultArtifacts);
    const rules = resultArtifacts.rules
      .filter((rule) => rule.toolName === args.toolName);
    if (!rules.length && !resultArtifacts.auto) {
      return args.output;
    }

    const manuallyCaptured = rules.reduce((currentOutput, rule) => McpHostExtensionService.applyResultArtifactRule({
      ...args,
      output: currentOutput,
      rule,
    }), cloneDeep(args.output));

    return resultArtifacts.auto
      ? McpHostExtensionService.applyAutoResultArtifactRules({
          ...args,
          auto: resultArtifacts.auto,
          output: manuallyCaptured,
        })
      : manuallyCaptured;
  }

  private static applyResultArtifactRule(args: {
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
    output: unknown;
    rule: McpHostResultArtifactRule;
    sourceTool: string;
    toolName: string;
  }): unknown {
    const path = McpHostExtensionService.normalizeResultPath(args.rule.path);
    if (!path.length) {
      return args.output;
    }

    const value = get(args.output, path);
    if (value === undefined) {
      return args.output;
    }

    const content = McpHostExtensionService.serializeArtifactContent(value);
    const artifact = new ArtifactService({ artifactRoot: args.context.artifactRoot }).saveText({
      content,
      kind: args.rule.kind,
      domain: args.rule.domain,
      title: args.rule.title ?? McpHostExtensionService.defaultArtifactTitle({
        rule: args.rule,
        sourceTool: args.sourceTool,
        path,
      }),
      extension: args.rule.extension,
      mimeType: args.rule.mimeType,
      sessionId: args.context.sessionId,
      sourceTool: args.sourceTool,
      metadata: {
        ...(args.rule.metadata ?? {}),
        mcpServerId: args.options.serverId,
        mcpToolName: args.toolName,
        resultPath: path,
      },
      setCurrent: args.rule.setCurrent,
    });
    const preview = content.slice(0, args.rule.maxPreviewChars ?? 1_000);
    const artifactOutput = {
      artifact: {
        ...artifact,
        relativePath: ArtifactService.relativeArtifactPath(args.context.artifactRoot, artifact),
      },
      contentPath: path,
      preview,
      omittedCharacters: Math.max(content.length - preview.length, 0),
    } satisfies McpHostResultArtifactOutput;

    McpHostExtensionService.outputReplacementPaths(args.rule, path)
      .forEach((replacementPath) => set(args.output as object, replacementPath, artifactOutput));

    return args.output;
  }

  private static applyAutoResultArtifactRules(args: {
    auto: McpHostAutoResultArtifactsOptions;
    context: ToolToolkitContext;
    options: DefineMcpHostExtensionOptions;
    output: unknown;
    sourceTool: string;
    toolName: string;
  }): unknown {
    const minChars = args.auto.minChars ?? 1_200;
    const candidates = McpHostExtensionService.findStringResultCandidates(args.output)
      .filter((candidate) => candidate.content.length >= minChars)
      .filter((candidate) => !McpHostExtensionService.isArtifactReferencePath(candidate.path));
    const grouped = McpHostExtensionService.groupCandidatesByContent(candidates);

    grouped.forEach((group) => {
      const primary = McpHostExtensionService.selectAutoArtifactPrimary(args.auto, group);
      if (!primary) {
        return;
      }

      const hint = McpHostExtensionService.resolveAutoArtifactHint(args.auto, primary.path);
      const kind = hint.kind ?? args.auto.kind ?? McpHostExtensionService.inferArtifactKind(primary);
      const extension = hint.extension ?? args.auto.extension ?? McpHostExtensionService.inferArtifactExtension(kind, primary);
      const contentPath = primary.path;
      const artifact = new ArtifactService({ artifactRoot: args.context.artifactRoot }).saveText({
        content: primary.content,
        kind,
        domain: hint.domain ?? args.auto.domain,
        title: hint.title ?? McpHostExtensionService.defaultAutoArtifactTitle({
          extension,
          sourceTool: args.sourceTool,
          path: contentPath,
        }),
        extension,
        mimeType: hint.mimeType ?? args.auto.mimeType ?? McpHostExtensionService.inferArtifactMimeType(kind),
        sessionId: args.context.sessionId,
        sourceTool: args.sourceTool,
        metadata: {
          ...(args.auto.metadata ?? {}),
          ...(hint.metadata ?? {}),
          mcpServerId: args.options.serverId,
          mcpToolName: args.toolName,
          resultPath: contentPath,
          autoCaptured: true,
        },
        setCurrent: hint.setCurrent ?? args.auto.setCurrent,
      });
      const preview = primary.content.slice(0, hint.maxPreviewChars ?? args.auto.maxPreviewChars ?? 1_000);
      const artifactOutput = {
        artifact: {
          ...artifact,
          relativePath: ArtifactService.relativeArtifactPath(args.context.artifactRoot, artifact),
        },
        contentPath,
        preview,
        omittedCharacters: Math.max(primary.content.length - preview.length, 0),
      } satisfies McpHostResultArtifactOutput;
      const replacementPaths = args.auto.replaceDuplicateContent === false
        ? [primary.path]
        : group.map((candidate) => candidate.path);

      replacementPaths.forEach((path) => set(args.output as object, path, artifactOutput));
    });

    return args.output;
  }

  private static outputReplacementPaths(rule: McpHostResultArtifactRule, path: string[]): string[][] {
    const replacementPaths = (rule.replacePaths ?? [])
      .map((candidate) => McpHostExtensionService.normalizeResultPath(candidate))
      .filter((candidate) => candidate.length > 0);

    return [path, ...replacementPaths];
  }

  private static normalizeResultPath(path: string | readonly string[]): string[] {
    return typeof path === 'string'
      ? path.split('.').map((part) => part.trim()).filter((part) => part.length > 0)
      : [...path];
  }

  private static serializeArtifactContent(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }

  private static resolveResultArtifacts(
    resultArtifacts: McpHostResultArtifactsOptions | undefined,
  ): ResolvedResultArtifactsOptions {
    if (!resultArtifacts) {
      return { rules: [] };
    }

    if (McpHostExtensionService.isResultArtifactRuleArray(resultArtifacts)) {
      return { rules: resultArtifacts };
    }

    return {
      rules: resultArtifacts.rules ?? [],
      ...(resultArtifacts.auto
        ? { auto: resultArtifacts.auto === true ? {} : resultArtifacts.auto }
        : {}),
    };
  }

  private static isResultArtifactRuleArray(
    resultArtifacts: McpHostResultArtifactsOptions,
  ): resultArtifacts is readonly McpHostResultArtifactRule[] {
    return Array.isArray(resultArtifacts);
  }

  private static findStringResultCandidates(value: unknown, path: string[] = []): ResultArtifactCandidate[] {
    if (typeof value === 'string') {
      return [{ content: value, path }];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item, index) => McpHostExtensionService.findStringResultCandidates(item, [
        ...path,
        String(index),
      ]));
    }

    if (!isRecord(value)) {
      return [];
    }

    return Object.entries(value).flatMap(([key, item]) => (
      McpHostExtensionService.findStringResultCandidates(item, [...path, key])
    ));
  }

  private static groupCandidatesByContent(candidates: ResultArtifactCandidate[]): ResultArtifactCandidate[][] {
    const groups = new Map<string, ResultArtifactCandidate[]>();
    candidates.forEach((candidate) => {
      groups.set(candidate.content, [...(groups.get(candidate.content) ?? []), candidate]);
    });
    return [...groups.values()];
  }

  private static resolveAutoArtifactHint(
    auto: McpHostAutoResultArtifactsOptions,
    path: string[],
  ): McpHostAutoResultArtifactHint {
    return auto.hints?.find((hint) => McpHostExtensionService.matchesAutoArtifactHint(hint, path)) ?? {};
  }

  private static selectAutoArtifactPrimary(
    auto: McpHostAutoResultArtifactsOptions,
    group: ResultArtifactCandidate[],
  ): ResultArtifactCandidate | undefined {
    return group.find((candidate) => Object.keys(McpHostExtensionService.resolveAutoArtifactHint(auto, candidate.path)).length > 0)
      ?? group[0];
  }

  private static matchesAutoArtifactHint(hint: McpHostAutoResultArtifactHint, path: string[]): boolean {
    const normalizedPath = path.join('.').toLowerCase();
    const exactPath = hint.path ? McpHostExtensionService.normalizeResultPath(hint.path).join('.').toLowerCase() : undefined;
    if (exactPath && normalizedPath === exactPath) {
      return true;
    }

    const includes = hint.pathIncludes === undefined
      ? []
      : Array.isArray(hint.pathIncludes)
        ? hint.pathIncludes
        : [hint.pathIncludes];
    return includes.length > 0 && includes.every((part) => normalizedPath.includes(part.toLowerCase()));
  }

  private static isArtifactReferencePath(path: string[]): boolean {
    return path.includes('artifact') || path.includes('contentPath') || path.includes('omittedCharacters');
  }

  private static inferArtifactKind(candidate: ResultArtifactCandidate): ArtifactKind {
    const path = candidate.path.join('.').toLowerCase();
    const trimmed = candidate.content.trimStart().toLowerCase();
    if (path.includes('html') || trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
      return 'html';
    }

    if (path.includes('json')) {
      return 'json';
    }

    return 'source';
  }

  private static inferArtifactExtension(kind: ArtifactKind, candidate: ResultArtifactCandidate): string {
    if (kind === 'html') {
      return 'html';
    }

    if (kind === 'json') {
      return 'json';
    }

    const path = candidate.path.join('.').toLowerCase();
    return path.includes('markdown') || path.endsWith('.md') ? 'md' : 'txt';
  }

  private static inferArtifactMimeType(kind: ArtifactKind): string {
    if (kind === 'html') {
      return 'text/html';
    }

    if (kind === 'json') {
      return 'application/json';
    }

    return 'text/plain';
  }

  private static defaultArtifactTitle(args: {
    rule: McpHostResultArtifactRule;
    sourceTool: string;
    path: string[];
  }): string {
    const resultName = args.path[args.path.length - 1] ?? 'result';
    const extension = args.rule.extension?.replace(/^\./, '') ?? args.rule.kind;
    return `${args.sourceTool}-${resultName}.${extension}`;
  }

  private static defaultAutoArtifactTitle(args: {
    extension: string;
    sourceTool: string;
    path: string[];
  }): string {
    const resultName = args.path[args.path.length - 1] ?? 'result';
    return `${args.sourceTool}-${resultName}.${args.extension}`;
  }

  private static describeTool(options: DefineMcpHostExtensionOptions, tool: McpToolDescriptor): string {
    return tool.description ?? tool.title ?? `MCP tool "${tool.name}" from server "${options.serverId}".`;
  }

  private static toHostToolName(options: DefineMcpHostExtensionOptions, toolName: string): string {
    const normalizedToolName = normalizeToolPart(toolName);
    return options.toolNamePrefix
      ? `${normalizeToolPart(options.toolNamePrefix)}__${normalizedToolName}`
      : normalizedToolName;
  }

  private static createMcpService(context: ToolToolkitContext): McpService {
    return new McpService({
      workspaceRoot: context.workspaceRoot,
      stateRoot: context.stateRoot,
    });
  }
}

export function defineMcpHostExtension(options: DefineMcpHostExtensionOptions): ConversationEngineHostExtension {
  return McpHostExtensionService.define(options);
}

export async function prepareMcpHostExtensionCatalog(
  options: PrepareMcpHostExtensionCatalogOptions,
): Promise<PrepareMcpHostExtensionCatalogResult> {
  const mcp = new McpService({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
  });
  const currentDocument = mcp.readConfigDocument();

  if (currentDocument.issues.length > 0) {
    return {
      ok: false,
      serverId: options.serverId,
      step: 'save_config',
      error: currentDocument.issues.map((issue) => issue.message).join('; '),
    };
  }

  const save = mcp.saveConfigDocument(buildMcpConfigDocumentContent({
    content: currentDocument.content,
    serverId: options.serverId,
    server: options.server,
  }));

  if (!save.ok) {
    return {
      ok: false,
      serverId: options.serverId,
      step: 'save_config',
      error: save.error,
    };
  }

  const activation = mcp.activateServer(options.serverId);
  if (!activation.ok) {
    return {
      ok: false,
      serverId: options.serverId,
      step: 'activate_server',
      error: activation.reason,
    };
  }

  const refresh = await mcp.refreshServer(options.serverId);
  if (!refresh.ok) {
    return {
      ok: false,
      serverId: options.serverId,
      step: 'refresh_catalog',
      error: refresh.error,
    };
  }

  return {
    ok: true,
    serverId: options.serverId,
    refresh,
    toolNames: refresh.record.tools.map((tool) => tool.name),
  };
}

export async function prepareMcpHostExtension(
  options: PrepareMcpHostExtensionOptions,
): Promise<PrepareMcpHostExtensionResult> {
  const prepared = await prepareMcpHostExtensionCatalog({
    workspaceRoot: options.workspaceRoot,
    stateRoot: options.stateRoot,
    serverId: options.serverId,
    server: options.server,
  });

  return prepared.ok
    ? {
        ...prepared,
        extension: defineMcpHostExtension(options),
      }
    : prepared;
}

function normalizeToolPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
}

function buildMcpConfigDocumentContent(input: {
  content: string;
  serverId: string;
  server: Record<string, unknown>;
}): string {
  const raw = input.content.trim().length > 0
    ? JSON.parse(input.content) as unknown
    : {};
  const config = isRecord(raw) ? raw : {};
  const mcpServers = isRecord(config.mcpServers) ? config.mcpServers : {};

  return JSON.stringify({
    ...config,
    mcpServers: {
      ...mcpServers,
      [input.serverId]: input.server,
    },
  }, null, 2);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
}
