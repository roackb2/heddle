import { createWebSearchTool } from '../web-search.js';
import type { ToolToolkit } from '../toolkit.js';

export const webToolkit: ToolToolkit = {
  id: 'web',
  createTools(context) {
    return [
      createWebSearchTool({
        model: context.model,
        apiKey: context.apiKey,
        providerCredentialSource: context.providerCredentialSource,
        credentialStorePath: context.credentialStorePath,
      }),
    ];
  },
};
