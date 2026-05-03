import { createViewImageTool } from './view-image.js';
import { createWebSearchTool } from './web-search.js';
import type { ToolToolkit } from '../../toolkit.js';

export const externalContextToolkit: ToolToolkit = {
  id: 'external-context',
  createTools(context) {
    return [
      createWebSearchTool({
        model: context.model,
        apiKey: context.apiKey,
        providerCredentialSource: context.providerCredentialSource,
        credentialStorePath: context.credentialStorePath,
      }),
      createViewImageTool({
        model: context.model,
        apiKey: context.apiKey,
        providerCredentialSource: context.providerCredentialSource,
        credentialStorePath: context.credentialStorePath,
        workspaceRoot: context.workspaceRoot,
      }),
    ];
  },
};
