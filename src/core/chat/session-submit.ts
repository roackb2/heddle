import { join } from 'node:path';
import {
  createDefaultAgentTools,
  createLlmAdapter,
  DEFAULT_OPENAI_MODEL,
  inferProviderFromModel,
  runAgentLoop,
} from '../../index.js';
import { compactChatHistory, estimateChatHistoryTokens } from './compaction.js';
import { loadChatSessions, saveChatSessions, touchSession } from './storage.js';
import type { ChatSession } from './types.js';
import { buildConversationMessages, countAssistantSteps, formatChatFailureMessage, summarizeTrace } from './format.js';
import { saveTrace } from './trace.js';
import { resolveApiKeyForModel } from '../../runtime/api-keys.js';

export type SubmitChatSessionPromptArgs = {
  workspaceRoot: string;
  stateRoot: string;
  sessionsPath: string;
  sessionId: string;
  prompt: string;
};

export async function submitChatSessionPrompt(args: SubmitChatSessionPromptArgs) {
  const sessions = loadChatSessions(args.sessionsPath, true);
  const session = sessions.find((candidate) => candidate.id === args.sessionId);
  if (!session) {
    throw new Error(`Chat session not found: ${args.sessionId}`);
  }

  const model = session.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const provider = inferProviderFromModel(model);
  const apiKey = resolveApiKeyForModel(model);
  if (!apiKey) {
    throw new Error(`Missing provider API key for ${provider}`);
  }

  const llm = createLlmAdapter({ model, apiKey });
  const tools = createDefaultAgentTools({
    model,
    apiKey,
    workspaceRoot: args.workspaceRoot,
    memoryDir: join(args.stateRoot, 'memory'),
    searchIgnoreDirs: [],
    includePlanTool: true,
  });

  const result = await runAgentLoop({
    goal: args.prompt,
    model,
    apiKey,
    workspaceRoot: args.workspaceRoot,
    stateDir: args.stateRoot,
    memoryDir: join(args.stateRoot, 'memory'),
    llm,
    tools,
    includeDefaultTools: false,
    history: session.history,
  });

  const compacted = compactChatHistory({
    history: result.transcript,
    model,
    usage: result.usage,
    toolNames: tools.map((tool) => tool.name),
    goal: args.prompt,
  });
  const traceFile = saveTrace(join(args.stateRoot, 'traces'), result.trace);
  const nextTurn = {
    id: `server-turn-${Date.now()}`,
    prompt: args.prompt,
    outcome: result.outcome,
    summary: result.summary,
    steps: countAssistantSteps(result.trace),
    traceFile,
    events: summarizeTrace(result.trace),
  };

  const formattedSummary =
    result.outcome === 'error' ?
      formatChatFailureMessage(result.summary, {
        model,
        estimatedHistoryTokens: estimateChatHistoryTokens(session.history),
      })
    : result.summary;

  const updatedSession: ChatSession = touchSession({
    ...session,
    lastContinuePrompt: args.prompt,
    history: compacted.history,
    context: compacted.context,
    messages: buildConversationMessages(compacted.history),
    turns: [...session.turns, nextTurn].slice(-8),
  });

  const nextSessions = sessions.map((candidate) => candidate.id === session.id ? updatedSession : candidate);
  saveChatSessions(args.sessionsPath, nextSessions);

  return {
    outcome: result.outcome,
    summary: formattedSummary,
    session: updatedSession,
  };
}
