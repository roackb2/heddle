// ---------------------------------------------------------------------------
// LLM Adapter — OpenAI implementation
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import type {
  ResponseInputItem,
  FunctionTool,
  ResponseReasoningItem,
  Response,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type { LlmAdapter, ChatMessage, LlmResponse, LlmAdapterCapabilities, LlmUsage, LlmStreamEvent } from './types.js';
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
    apiKey: firstDefinedNonEmpty(options.apiKey, process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY),
  });
  const model = options.model ?? DEFAULT_OPENAI_MODEL;
  const capabilities: LlmAdapterCapabilities = {
    toolCalls: true,
    systemMessages: true,
    reasoningSummaries: true,
    parallelToolCalls: true,
  };

  return {
    info: {
      provider: 'openai',
      model,
      capabilities,
    },
    async chat(
      messages: ChatMessage[],
      tools: ToolDefinition[],
      signal?: AbortSignal,
      onStreamEvent?: (event: LlmStreamEvent) => void,
    ): Promise<LlmResponse> {
      const stream = await client.responses.stream({
        model,
        input: toResponseInput(messages),
        tools: tools.length > 0 ? tools.map(toResponseTool) : undefined,
        reasoning: {
          summary: 'detailed',
        },
      }, { signal });

      let streamedContent = '';
      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          streamedContent += event.delta;
          onStreamEvent?.({ type: 'content.delta', delta: event.delta });
          continue;
        }

        if (event.type === 'response.output_text.done') {
          streamedContent = event.text;
          onStreamEvent?.({ type: 'content.done', content: event.text });
        }
      }

      const response = await stream.finalResponse();
      const toolCalls = response.output.flatMap((item): ToolCall[] => {
        if (
          item.type !== 'function_call'
          || typeof (item as { call_id?: unknown }).call_id !== 'string'
          || typeof (item as { name?: unknown }).name !== 'string'
          || typeof (item as { arguments?: unknown }).arguments !== 'string'
        ) {
          return [];
        }

        return [{
          id: item.call_id,
          tool: item.name,
          input: JSON.parse(item.arguments),
        }];
      });
      const diagnostics = extractAssistantDiagnostics(response, toolCalls.length > 0);
      const content = streamedContent || (diagnostics?.rationale ?? extractAssistantContent(response, toolCalls.length > 0));

      if (!streamedContent && content) {
        onStreamEvent?.({ type: 'content.delta', delta: content });
        onStreamEvent?.({ type: 'content.done', content });
      }

      return {
        content,
        diagnostics,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: extractUsage(response),
      };
    },
  };
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
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

function extractUsage(response: Response): LlmUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  return {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.total_tokens,
    cachedInputTokens: response.usage.input_tokens_details.cached_tokens || undefined,
    reasoningTokens: response.usage.output_tokens_details.reasoning_tokens || undefined,
    requests: 1,
  };
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
