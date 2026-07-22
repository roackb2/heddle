import type {
  LlmResponse,
  LlmStreamEvent,
  LlmUsage,
} from '@/core/llm/types.js';
import {
  KimiCodec,
  type KimiAccumulatedToolCall,
} from './kimi-codec.js';

type KimiToolCallDelta = {
  index?: unknown;
  id?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
};

/** Accumulates one streamed Kimi chat completion into Heddle's neutral response. */
export class KimiChatCompletionsStreamDecoder {
  private readonly contentParts: string[] = [];
  private readonly reasoningParts: string[] = [];
  private readonly toolCalls = new Map<number, KimiAccumulatedToolCall>();
  private usage?: LlmUsage;
  private done = false;

  constructor(private readonly onStreamEvent?: (event: LlmStreamEvent) => void) {}

  accept(data: string): void {
    if (data.trim() === '[DONE]') {
      this.done = true;
      return;
    }

    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch (error) {
      throw new Error('Kimi Platform stream contained invalid JSON.', { cause: error });
    }

    this.usage = KimiCodec.extractUsage(chunk) ?? this.usage;
    const delta = KimiChatCompletionsStreamDecoder.firstDelta(chunk);
    if (!delta) {
      return;
    }

    if (typeof delta.reasoning_content === 'string') {
      this.reasoningParts.push(delta.reasoning_content);
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.contentParts.push(delta.content);
      this.onStreamEvent?.({ type: 'content.delta', delta: delta.content });
    }

    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((call) => this.acceptToolCall(call));
    }
  }

  finish(): LlmResponse {
    if (!this.done) {
      throw new Error('Kimi Platform stream ended before the [DONE] marker.');
    }

    const content = this.contentParts.join('') || undefined;
    const reasoningContent = this.reasoningParts.join('') || undefined;
    if (content) {
      this.onStreamEvent?.({ type: 'content.done', content });
    }

    return {
      content,
      toolCalls: KimiCodec.parseToolCalls([...this.toolCalls.values()]),
      ...(reasoningContent ? {
        providerContinuation: {
          provider: 'kimi',
          reasoningContent,
        },
      } : {}),
      usage: this.usage,
    };
  }

  private acceptToolCall(value: unknown): void {
    if (!value || typeof value !== 'object') {
      throw new Error('Kimi Platform stream contained a malformed tool-call delta.');
    }

    const delta = value as KimiToolCallDelta;
    if (!Number.isSafeInteger(delta.index) || Number(delta.index) < 0) {
      throw new Error('Kimi Platform stream contained a tool-call delta without a valid index.');
    }

    const index = Number(delta.index);
    const current = this.toolCalls.get(index) ?? {
      index,
      id: '',
      name: '',
      argumentsText: '',
    };
    this.toolCalls.set(index, {
      index,
      id: current.id + (typeof delta.id === 'string' ? delta.id : ''),
      name: current.name + (typeof delta.function?.name === 'string' ? delta.function.name : ''),
      argumentsText: current.argumentsText + (
        typeof delta.function?.arguments === 'string' ? delta.function.arguments : ''
      ),
    });
  }

  private static firstDelta(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object') {
      throw new Error('Kimi Platform stream contained a non-object payload.');
    }

    const choices = (value as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return undefined;
    }

    const delta = (choices[0] as { delta?: unknown } | undefined)?.delta;
    if (delta === undefined || delta === null) {
      return undefined;
    }
    if (typeof delta !== 'object') {
      throw new Error('Kimi Platform stream contained a malformed choice delta.');
    }
    return delta as Record<string, unknown>;
  }
}
