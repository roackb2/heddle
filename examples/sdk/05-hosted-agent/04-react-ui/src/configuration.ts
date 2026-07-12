import {
  resolveHostedAgentBrowserStorage,
  type HostedAgentBrowserStorage,
} from './browser-storage.js';

const SessionStorageKey = 'heddle:hosted-react-example:session-id';

export type HostedAgentExampleConfiguration = {
  baseUrl: string;
  bearerToken?: string;
  sessionId: string;
  sessionPersistenceAvailable: boolean;
};

export function readHostedAgentExampleConfiguration(): HostedAgentExampleConfiguration {
  const configuredSessionId = import.meta.env.VITE_HEDDLE_EXAMPLE_SESSION_ID?.trim();
  const storedSession = configuredSessionId
    ? { sessionId: configuredSessionId, persisted: true }
    : readOrCreateSessionId(resolveHostedAgentBrowserStorage());
  return {
    baseUrl: import.meta.env.VITE_HEDDLE_EXAMPLE_AGENT_URL?.trim() || '/api/agent',
    bearerToken: import.meta.env.VITE_HEDDLE_EXAMPLE_BEARER_TOKEN?.trim() || undefined,
    sessionId: storedSession.sessionId,
    sessionPersistenceAvailable: storedSession.persisted,
  };
}

function readOrCreateSessionId(
  storage: HostedAgentBrowserStorage | undefined,
): { sessionId: string; persisted: boolean } {
  if (!storage) {
    return { sessionId: `hosted-react-${crypto.randomUUID()}`, persisted: false };
  }
  try {
    const existing = storage.getItem(SessionStorageKey)?.trim();
    if (existing) {
      return { sessionId: existing, persisted: true };
    }
    const sessionId = `hosted-react-${crypto.randomUUID()}`;
    storage.setItem(SessionStorageKey, sessionId);
    return { sessionId, persisted: true };
  } catch {
    return { sessionId: `hosted-react-${crypto.randomUUID()}`, persisted: false };
  }
}
