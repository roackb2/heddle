// ---------------------------------------------------------------------------
// LLM Adapter — OpenAI implementation
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import type { ResponseInputItem, FunctionTool, ResponseFunctionToolCall, ResponseReasoningItem, Response } from 'openai/resources/responses/responses.js';
import type { LlmAdapter, ChatMessage, LlmResponse } from './types.js';
import type { AssistantDiagnostics, ToolDefinition, ToolCall } from '../types.js';
import { DEFAULT_OPENAI_MODEL } from '../config.js';

export type OpenAiAdapterOptions = {
  apiKey?: string;
  model?: string;
};

/**
 * Create an LLM adapter backed by the OpenAI chat completions API.
 */
export function createOpenAiAdapter(options: OpenAiAdapterOptions = {}): LlmAdapter {
  const client = new OpenAI({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
  });
  const model = options.model ?? DEFAULT_OPENAI_MODEL;

  return {
    async chat(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<LlmResponse> {
      const response = await client.responses.create({
        model,
        input: toResponseInput(messages),
        tools: tools.length > 0 ? tools.map(toResponseTool) : undefined,
        reasoning: {
          summary: 'detailed',
        },
      }, { signal });

      const toolCalls = response.output
        .filter((item): item is ResponseFunctionToolCall => item.type === 'function_call')
        .map((item): ToolCall => ({
          id: item.call_id,
          tool: item.name,
          input: JSON.parse(item.arguments),
        }));
      const diagnostics = extractAssistantDiagnostics(response, toolCalls.length > 0);
      const content = diagnostics?.rationale ?? extractAssistantContent(response, toolCalls.length > 0);

      return {
        content,
        diagnostics,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Internal converters
// ---------------------------------------------------------------------------

function extractAssistantContent(response: Response, hasToolCalls: boolean): string | undefined {
  if (response.output_text) {
    return response.output_text;
  }

  if (!hasToolCalls) {
    return undefined;
  }

  const reasoningSummary = response.output
    .filter((item): item is ResponseReasoningItem => item.type === 'reasoning')
    .flatMap((item) => item.summary)
    .map((summary) => summary.text.trim())
    .filter(Boolean)
    .join(' ');

  return reasoningSummary || undefined;
}

function extractAssistantDiagnostics(response: Response, hasToolCalls: boolean): AssistantDiagnostics | undefined {
  if (!hasToolCalls) {
    return undefined;
  }

  const rationale = response.output
    .filter((item): item is ResponseReasoningItem => item.type === 'reasoning')
    .flatMap((item) => item.summary)
    .map((summary) => summary.text.trim())
    .filter(Boolean)
    .join(' ');

  if (!rationale) {
    return undefined;
  }

  return { rationale };
}

function toResponseInput(messages: ChatMessage[]): ResponseInputItem[] {
  return messages.flatMap((message) => toResponseInputItems(message));
}

function toResponseInputItems(msg: ChatMessage): ResponseInputItem[] {
  switch (msg.role) {
    case 'system':
      return [{ type: 'message', role: 'system', content: msg.content }];
    case 'user':
      return [{ type: 'message', role: 'user', content: msg.content }];
    case 'assistant': {
      const items: ResponseInputItem[] = [];
      if (msg.content) {
        items.push({ type: 'message', role: 'assistant', content: msg.content });
      }
      if (msg.toolCalls) {
        for (const call of msg.toolCalls) {
          items.push({
            type: 'function_call',
            call_id: call.id,
            name: call.tool,
            arguments: JSON.stringify(call.input),
          });
        }
      }
      return items;
    }
    case 'tool':
      return [
        {
          type: 'function_call_output',
          call_id: msg.toolCallId,
          output: msg.content,
        },
      ];
  }
}

function toResponseTool(tool: ToolDefinition): FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}
