import type { ToolDefinition } from '../types.js';

export type ToolToolkitContext = {
  workspaceRoot: string;
  stateRoot: string;
  artifactRoot: string;
  /** Custom artifact persistence. When set, artifact tools use it instead of the file store at `artifactRoot`. */
  artifactRepository?: import('../artifacts/index.js').ArtifactRepository;
  sessionId?: string;
  model: string;
  apiKey?: string;
  providerCredentialSource?: import('../runtime/credentials/index.js').ProviderCredentialSource;
  credentialStorePath?: string;
  memoryDir: string;
  memoryMode: 'none' | 'read-and-record' | 'maintainer' | 'legacy-full';
  searchIgnoreDirs?: string[];
  hiddenMcpServerIds?: string[];
};

export type ToolToolkit = {
  id: string;
  createTools(context: ToolToolkitContext): ToolDefinition[];
};

/**
 * Composes production toolkits into a duplicate-checked tool bundle.
 */
export class ToolBundleComposer {
  static compose(args: {
    toolkits: readonly ToolToolkit[];
    context: ToolToolkitContext;
  }): ToolDefinition[] {
    const seenToolkitIds = new Set<string>();
    const seenToolNames = new Set<string>();
    const tools: ToolDefinition[] = [];

    for (const toolkit of args.toolkits) {
      if (seenToolkitIds.has(toolkit.id)) {
        throw new Error(`Duplicate toolkit id: ${toolkit.id}`);
      }
      seenToolkitIds.add(toolkit.id);

      const toolkitTools = toolkit.createTools(args.context);
      for (const tool of toolkitTools) {
        if (seenToolNames.has(tool.name)) {
          throw new Error(`Duplicate tool name from toolkits: ${tool.name}`);
        }
        seenToolNames.add(tool.name);
        tools.push(tool);
      }
    }

    return tools;
  }
}
