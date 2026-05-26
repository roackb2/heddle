import React from 'react';
import { render } from 'ink';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import { App } from './App.js';
import { ControlPlaneSessionStore } from './state/control-plane-session-store.js';
import type { ControlPlaneSessionStoreStartInput } from './state/control-plane-session-store.js';

export type ChatCliV2Options = ControlPlaneSessionStoreStartInput & {
  trpcUrl: string;
  model?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  apiKey?: string;
  preferApiKey?: boolean;
};

export function startChatCliV2(options: ChatCliV2Options) {
  const client = ClientSharedProxyApiService.createClient({
    url: options.trpcUrl,
  });
  const store = new ControlPlaneSessionStore({
    client,
    defaultModel: options.model,
    maxSteps: options.maxSteps,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
    apiKey: options.apiKey,
    preferApiKey: options.preferApiKey,
  });

  render(<App store={store} initialSelection={{
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
  }} />);
}
