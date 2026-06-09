import { join, resolve } from 'node:path';
import { BrowserAutomationCapabilityService } from '@/core/browser/index.js';
import { agentSkillsToolkit } from '@/core/tools/toolkits/agent-skills/toolkit.js';
import { createBrowserResearchToolkit } from '@/core/tools/toolkits/browser-research/index.js';
import { codingAwarenessToolkit } from '@/core/tools/toolkits/coding-awareness/toolkit.js';
import { codingFilesToolkit } from '@/core/tools/toolkits/coding-files/toolkit.js';
import { externalContextToolkit } from '@/core/tools/toolkits/external-context/toolkit.js';
import { internalToolkit } from '@/core/tools/toolkits/internal/toolkit.js';
import { knowledgeToolkit } from '@/core/tools/toolkits/knowledge/toolkit.js';
import { mcpToolkit } from '@/core/tools/toolkits/mcp/toolkit.js';
import { shellProcessToolkit } from '@/core/tools/toolkits/shell-process/toolkit.js';
import { ToolBundleComposer, type ToolToolkit } from '@/core/tools/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { DefaultAgentToolsOptions } from './types.js';

/**
 * Owns the default tool bundle policy for generic runtime execution.
 */
export class RuntimeToolService {
  static createDefaultAgentTools(options: DefaultAgentToolsOptions): ToolDefinition[] {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const stateRoot = options.stateRoot ?? resolve(workspaceRoot, options.stateDir ?? '.heddle');
    const memoryDir =
      options.memoryDir ??
      join(stateRoot, 'memory');
    const memoryMode = options.memoryMode ?? 'read-and-record';

    return ToolBundleComposer.compose({
      toolkits: this.createDefaultToolkits({
        includePlanTool: options.includePlanTool,
        browserAutomationEnabled: BrowserAutomationCapabilityService.isEnabled({ stateRoot }),
        stateRoot,
      }),
      context: {
        workspaceRoot,
        stateRoot,
        model: options.model,
        apiKey: options.apiKey,
        providerCredentialSource: options.providerCredentialSource,
        credentialStorePath: options.credentialStorePath,
        memoryDir,
        memoryMode,
        searchIgnoreDirs: options.searchIgnoreDirs,
      },
    });
  }

  private static createDefaultToolkits(args: {
    includePlanTool?: boolean;
    browserAutomationEnabled: boolean;
    stateRoot: string;
  }): ToolToolkit[] {
    const browserToolkits = args.browserAutomationEnabled
      ? [
        createBrowserResearchToolkit({
          stateRoot: args.stateRoot,
          allowedDomains: [],
          profileId: 'browser-automation',
          maxElementsPerSnapshot: 80,
        }),
      ]
      : [];

    return [
      agentSkillsToolkit,
      codingAwarenessToolkit,
      codingFilesToolkit,
      externalContextToolkit,
      knowledgeToolkit,
      mcpToolkit,
      ...browserToolkits,
      this.createDefaultInternalToolkit({ includePlanTool: args.includePlanTool }),
      shellProcessToolkit,
    ];
  }

  private static createDefaultInternalToolkit(args: {
    includePlanTool?: boolean;
  }): ToolToolkit {
    if (args.includePlanTool ?? true) {
      return internalToolkit;
    }

    return {
      id: internalToolkit.id,
      createTools(context) {
        return internalToolkit.createTools(context).filter((tool) => tool.name !== 'update_plan');
      },
    };
  }
}
