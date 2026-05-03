import { createViewImageTool } from '../view-image.js';
import type { ToolToolkit } from '../toolkit.js';

export const imageToolkit: ToolToolkit = {
  id: 'image',
  createTools(context) {
    return [
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
