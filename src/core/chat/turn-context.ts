import type { ToolDefinition } from '../types.js';
import type { ChatSessionLeaseOwner } from './session-lease.js';
import type { ChatSession } from './types.js';
import { loadChatTurnSession } from './turn-session.js';
import { resolveChatTurnRuntime, type ChatTurnRuntime } from './turn-runtime.js';
import { createChatTurnTools, listChatTurnToolNames } from './turn-tools.js';

export type PrepareOrdinaryChatTurnContextArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionStoragePath: string;
  sessionId: string;
  apiKey?: string;
  preferApiKey?: boolean;
  credentialStorePath?: string;
  systemContext?: string;
  leaseOwner?: ChatSessionLeaseOwner;
};

export type OrdinaryChatTurnContext = {
  sessions: ChatSession[];
  session: ChatSession;
  runtime: ChatTurnRuntime;
  tools: ToolDefinition[];
  toolNames: string[];
  leaseOwner: ChatSessionLeaseOwner;
};

export function prepareOrdinaryChatTurnContext(args: PrepareOrdinaryChatTurnContextArgs): OrdinaryChatTurnContext {
  const { sessions, session } = loadChatTurnSession({
    sessionStoragePath: args.sessionStoragePath,
    sessionId: args.sessionId,
  });
  const runtime = resolveChatTurnRuntime({
    stateRoot: args.stateRoot,
    sessionModel: session.model,
    apiKey: args.apiKey,
    preferApiKey: args.preferApiKey,
    credentialStorePath: args.credentialStorePath,
    systemContext: args.systemContext,
  });
  const tools = createChatTurnTools({
    model: runtime.model,
    apiKey: runtime.apiKey,
    providerCredentialSource: runtime.providerCredentialSource,
    credentialStorePath: args.credentialStorePath,
    workspaceRoot: args.workspaceRoot,
    memoryDir: runtime.memoryDir,
  });

  return {
    sessions,
    session,
    runtime,
    tools,
    toolNames: listChatTurnToolNames(tools),
    leaseOwner: args.leaseOwner ?? {
      ownerKind: 'ask',
      ownerId: `submit-${process.pid}`,
      clientLabel: 'another Heddle client',
    },
  };
}
