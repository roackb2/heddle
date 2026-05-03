import { createDefaultAgentTools } from '../../../runtime/default-tools.js';
import type { ToolDefinition } from '../../../types.js';
import type { ChatSessionLeaseOwner } from '../sessions/lease.js';
import { loadChatSessions } from '../sessions/storage.js';
import type { ChatSession } from '../../types.js';
import { resolveConversationTurnRuntime, type ChatTurnRuntime } from './runtime.js';

export type PrepareConversationTurnContextArgs = {
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

export type ConversationTurnContext = {
  sessions: ChatSession[];
  session: ChatSession;
  runtime: ChatTurnRuntime;
  tools: ToolDefinition[];
  toolNames: string[];
  leaseOwner: ChatSessionLeaseOwner;
};

export function prepareConversationTurnContext(args: PrepareConversationTurnContextArgs): ConversationTurnContext {
  const sessions = loadChatSessions(args.sessionStoragePath, true);
  const session = sessions.find((candidate) => candidate.id === args.sessionId);
  if (!session) {
    throw new Error(`Chat session not found: ${args.sessionId}`);
  }

  const runtime = resolveConversationTurnRuntime({
    stateRoot: args.stateRoot,
    sessionModel: session.model,
    apiKey: args.apiKey,
    preferApiKey: args.preferApiKey,
    credentialStorePath: args.credentialStorePath,
    systemContext: args.systemContext,
  });
  const tools = createDefaultAgentTools({
    model: runtime.model,
    apiKey: runtime.apiKey,
    providerCredentialSource: runtime.providerCredentialSource,
    credentialStorePath: args.credentialStorePath,
    workspaceRoot: args.workspaceRoot,
    memoryDir: runtime.memoryDir,
    searchIgnoreDirs: [],
    includePlanTool: true,
  });

  return {
    sessions,
    session,
    runtime,
    tools,
    toolNames: tools.map((tool) => tool.name),
    leaseOwner: args.leaseOwner ?? {
      ownerKind: 'ask',
      ownerId: `submit-${process.pid}`,
      clientLabel: 'another Heddle client',
    },
  };
}
