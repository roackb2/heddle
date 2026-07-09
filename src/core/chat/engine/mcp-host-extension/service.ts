import { defineHostExtension } from '../host-extension.js';
import { McpHostToolDefinitionService } from './tool-definition-service.js';
import type { ConversationEngineHostExtension } from '../host-extension.js';
import type { DefineMcpHostExtensionOptions, ResolvedMcpHostExtensionData } from './types.js';

/**
 * Public facade for building MCP-backed host extensions.
 *
 * This service intentionally stays small: it composes the host-extension shell
 * and delegates setup, tool-definition, and artifact-compaction behavior to the
 * narrower services in this folder.
 */
export class McpHostExtensionService {
  static define(
    options: DefineMcpHostExtensionOptions,
    resolved?: ResolvedMcpHostExtensionData,
  ): ConversationEngineHostExtension {
    const toolkit = McpHostToolDefinitionService.createToolkit(options, resolved);

    return defineHostExtension({
      id: options.id,
      toolkits: [toolkit],
      ...(options.systemContext ? { systemContext: options.systemContext } : {}),
      ...(options.artifacts ? { artifacts: options.artifacts } : {}),
      ...(options.hideDefaultMcpTools ? { mcp: { hideDefaultServers: [options.serverId] } } : {}),
    });
  }
}
