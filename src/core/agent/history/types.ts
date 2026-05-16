import type { ChatMessage } from '@/core/llm/types.js';
import type { ToolCall } from '@/core/types.js';

export type SanitizeAgentHistoryArgs = {
  history: ChatMessage[];
};

export type AssistantWithTools = { role: 'assistant'; content: string; toolCalls: ToolCall[] };

export type ToolMessage = { role: 'tool'; content: string; toolCallId: string };
