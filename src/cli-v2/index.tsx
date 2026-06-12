import React from 'react';
import { render } from 'ink';
import { EventSource } from 'eventsource';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import { App } from './App.js';
import { ControlPlaneTerminalNotificationService } from './services/notifications/index.js';
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
    eventSource: EventSource,
  });
  const store = new ControlPlaneSessionStore({
    client,
    defaultModel: options.model,
    maxSteps: options.maxSteps,
    searchIgnoreDirs: options.searchIgnoreDirs,
    systemContext: options.systemContext,
    apiKey: options.apiKey,
    preferApiKey: options.preferApiKey,
    notificationService: new ControlPlaneTerminalNotificationService(),
  });

  return render(<App store={store} initialSelection={{
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
  }} />);
}
