import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  assertMcpCapabilityActive,
  McpCapabilityVerificationError,
} from '../index.js';
import type {
  AnyNodeMcpJsonToolDefinition,
  NodeMcpJsonToolDefinition,
  NodeMcpJsonToolsetConfig,
  NodeMcpToolRegistrationContext,
  NodeMcpToolset,
} from './types.js';

const ToolDefinitionSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  description: z.string().trim().min(1).max(4_096),
  failureMessage: z.string().trim().min(1).max(1_600),
}).passthrough();

export class NodeMcpJsonToolsetConfigurationError extends Error {
  readonly name = 'NodeMcpJsonToolsetConfigurationError';
}

/** Preserves a definition's inferred input type without adding runtime work. */
export function defineNodeMcpJsonTool<
  TTool extends string,
  TInput extends Record<string, unknown>,
>(
  definition: NodeMcpJsonToolDefinition<TTool, TInput>,
): NodeMcpJsonToolDefinition<TTool, TInput> {
  return definition;
}

/**
 * Capability-aware declarative tool registry for the common JSON-tool path.
 *
 * The signed capability is the only source of exposed tool names. Every call
 * checks authority before and after product work and converts unknown failures
 * into the definition's static public message.
 */
export class NodeMcpJsonToolset<TTool extends string>
implements NodeMcpToolset<TTool> {
  readonly serverInfo: Readonly<{ name: string; version: string }>;
  readonly #tools: ReadonlyMap<TTool, AnyNodeMcpJsonToolDefinition<TTool>>;
  readonly #now: () => Date;

  constructor(config: NodeMcpJsonToolsetConfig<TTool>) {
    this.serverInfo = Object.freeze({
      name: z.string().trim().min(1).max(128).parse(config.serverInfo.name),
      version: z.string().trim().min(1).max(128).parse(config.serverInfo.version),
    });
    const definitions = config.tools.map((definition) => {
      ToolDefinitionSchema.parse(definition);
      return definition;
    });
    const names = definitions.map(({ name }) => name);
    if (new Set(names).size !== names.length) {
      throw new NodeMcpJsonToolsetConfigurationError(
        'Node MCP JSON tool names must be unique.',
      );
    }
    this.#tools = new Map(definitions.map((definition) => [
      definition.name,
      definition,
    ]));
    this.#now = config.now ?? (() => new Date());
  }

  registerAllowedTools(
    context: NodeMcpToolRegistrationContext<TTool>,
  ): void {
    context.capability.allowedTools.forEach((toolName) => {
      const definition = this.#tools.get(toolName);
      if (!definition) {
        throw new NodeMcpJsonToolsetConfigurationError(
          'The signed MCP capability names an unconfigured product tool.',
        );
      }
      context.server.registerTool(
        definition.name,
        {
          ...(definition.title ? { title: definition.title } : {}),
          description: definition.description,
          inputSchema: definition.inputSchema,
          ...(definition.annotations
            ? { annotations: definition.annotations }
            : {}),
        },
        async (input, extra) => await this.#execute(
          definition,
          input as Record<string, unknown>,
          context,
          extra.signal,
        ),
      );
    });
  }

  async #execute(
    definition: AnyNodeMcpJsonToolDefinition<TTool>,
    input: Record<string, unknown>,
    context: NodeMcpToolRegistrationContext<TTool>,
    operationSignal: AbortSignal,
  ): Promise<CallToolResult> {
    const signal = AbortSignal.any([
      context.requestSignal,
      operationSignal,
    ]);
    try {
      signal.throwIfAborted();
      assertMcpCapabilityActive(context.capability, this.#now());
      const result = await definition.execute(input, {
        capability: context.capability,
        signal,
      });
      signal.throwIfAborted();
      assertMcpCapabilityActive(context.capability, this.#now());
      const text = JSON.stringify(result);
      if (text === undefined) {
        throw new TypeError('MCP JSON tools must return a serializable value.');
      }
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = signal.aborted
        ? 'Product tool execution was cancelled.'
        : error instanceof McpCapabilityVerificationError
          ? 'Product tool authority expired.'
          : definition.failureMessage;
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  }
}
