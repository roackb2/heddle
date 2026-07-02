import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkit } from '@/core/tools/index.js';
import uniq from 'lodash/uniq.js';

const HOST_EXTENSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type ConversationEngineHostArtifactOptions = {
  enabled?: boolean;
  root?: string;
};

export type ConversationEngineHostMcpOptions = {
  /**
   * Server ids that should be hidden from the default generic MCP toolkit.
   * Use this when a host extension exposes a curated tool surface for the same
   * MCP server and the generic mcp_* tools would create a duplicate path.
   */
  hideDefaultServers?: string[];
};

export type ConversationEngineHostExtension = {
  id: string;
  tools?: ToolDefinition[];
  toolkits?: ToolToolkit[];
  systemContext?: string;
  artifacts?: ConversationEngineHostArtifactOptions;
  mcp?: ConversationEngineHostMcpOptions;
};

export type ConversationEngineHostExtensionBundle = Omit<ConversationEngineHostExtension, 'id'> & {
  id?: string;
};

export type ConversationEngineHostExtensionInput =
  | ConversationEngineHostExtensionBundle
  | readonly ConversationEngineHostExtension[];

/**
 * Owns public SDK host-extension validation and deterministic composition.
 */
export class ConversationEngineHostExtensionService {
  static define(extension: ConversationEngineHostExtension): ConversationEngineHostExtension {
    ConversationEngineHostExtensionService.validateExtension(extension, { idRequired: true });
    return extension;
  }

  static compose(input?: ConversationEngineHostExtensionInput): ConversationEngineHostExtensionBundle | undefined {
    const extensions = ConversationEngineHostExtensionService.toExtensionArray(input);
    if (!extensions.length) {
      return undefined;
    }

    ConversationEngineHostExtensionService.assertUniqueExtensionIds(extensions);
    extensions.forEach((extension) => {
      ConversationEngineHostExtensionService.validateExtension(extension, { idRequired: 'id' in extension });
    });

    const tools = extensions.flatMap((extension) => extension.tools ?? []);
    const toolkits = extensions.flatMap((extension) => extension.toolkits ?? []);
    ConversationEngineHostExtensionService.assertUniqueNames({
      values: tools.map((tool) => tool.name),
      label: 'host extension tool name',
    });
    ConversationEngineHostExtensionService.assertUniqueNames({
      values: toolkits.map((toolkit) => toolkit.id),
      label: 'host extension toolkit id',
    });

    const systemContext = extensions
      .map((extension) => extension.systemContext)
      .filter((value): value is string => Boolean(value?.trim()))
      .join('\n\n') || undefined;
    const artifacts = ConversationEngineHostExtensionService.composeArtifacts(extensions);
    const mcp = ConversationEngineHostExtensionService.composeMcp(extensions);

    return {
      ...(tools.length ? { tools } : {}),
      ...(toolkits.length ? { toolkits } : {}),
      ...(systemContext ? { systemContext } : {}),
      ...(artifacts ? { artifacts } : {}),
      ...(mcp ? { mcp } : {}),
    };
  }

  private static toExtensionArray(input?: ConversationEngineHostExtensionInput): ConversationEngineHostExtensionBundle[] {
    if (!input) {
      return [];
    }

    return ConversationEngineHostExtensionService.isExtensionArray(input) ? [...input] : [input];
  }

  private static isExtensionArray(input: ConversationEngineHostExtensionInput): input is readonly ConversationEngineHostExtension[] {
    return Array.isArray(input);
  }

  private static validateExtension(extension: ConversationEngineHostExtensionBundle, options: { idRequired: boolean }): void {
    if (options.idRequired || extension.id) {
      ConversationEngineHostExtensionService.assertValidId(extension.id);
    }

    ConversationEngineHostExtensionService.assertUniqueNames({
      values: (extension.tools ?? []).map((tool) => tool.name),
      label: `host extension "${extension.id ?? '<legacy>'}" tool name`,
    });
    ConversationEngineHostExtensionService.assertUniqueNames({
      values: (extension.toolkits ?? []).map((toolkit) => toolkit.id),
      label: `host extension "${extension.id ?? '<legacy>'}" toolkit id`,
    });
  }

  private static assertValidId(id: string | undefined): void {
    if (!id || !HOST_EXTENSION_ID_PATTERN.test(id)) {
      throw new Error(`Invalid host extension id: ${id ?? '<missing>'}`);
    }
  }

  private static assertUniqueExtensionIds(extensions: ConversationEngineHostExtensionBundle[]): void {
    ConversationEngineHostExtensionService.assertUniqueNames({
      values: extensions.map((extension) => extension.id).filter((id): id is string => Boolean(id)),
      label: 'host extension id',
    });
  }

  private static assertUniqueNames(args: { values: string[]; label: string }): void {
    const seen = new Set<string>();
    const duplicate = args.values.find((value) => {
      if (seen.has(value)) {
        return true;
      }

      seen.add(value);
      return false;
    });
    if (duplicate) {
      throw new Error(`Duplicate ${args.label}: ${duplicate}`);
    }
  }

  private static composeArtifacts(extensions: ConversationEngineHostExtensionBundle[]): ConversationEngineHostArtifactOptions | undefined {
    const artifactConfigs = extensions
      .map((extension) => extension.artifacts)
      .filter((artifacts): artifacts is ConversationEngineHostArtifactOptions => Boolean(artifacts));
    if (!artifactConfigs.length) {
      return undefined;
    }

    return artifactConfigs.reduce<ConversationEngineHostArtifactOptions>((merged, artifacts) => ({
      ...merged,
      ...(artifacts.enabled === undefined ? {} : { enabled: artifacts.enabled }),
      ...(artifacts.root === undefined ? {} : { root: artifacts.root }),
    }), {});
  }

  private static composeMcp(extensions: ConversationEngineHostExtensionBundle[]): ConversationEngineHostMcpOptions | undefined {
    const hideDefaultServers = uniq(extensions
      .flatMap((extension) => extension.mcp?.hideDefaultServers ?? [])
      .map((serverId) => serverId.trim())
      .filter((serverId) => serverId.length > 0));

    return hideDefaultServers.length ? { hideDefaultServers } : undefined;
  }
}

export function defineHostExtension(extension: ConversationEngineHostExtension): ConversationEngineHostExtension {
  return ConversationEngineHostExtensionService.define(extension);
}
