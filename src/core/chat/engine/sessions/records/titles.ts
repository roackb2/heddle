/**
 * Pure session-title generation behavior.
 *
 * Owns the prompt and LLM call used to suggest a short chat session title.
 * Storage and auto-rename policy stay on the session service.
 */
import type { ChatMessage, LlmAdapter } from '@/core/llm/types.js';
import type { GenerateChatSessionTitleInput } from './types.js';
import { truncate } from '@/core/utils/text.js';

export class ChatSessionTitles {
  static buildPrompt(prompt: string, responseText: string): ChatMessage[] {
    return [
      {
        role: 'system',
        content:
          'You name chat sessions. Return only a short 3 to 6 word title in plain text. No quotes, no punctuation, no prefix.',
      },
      {
        role: 'user',
        content: `User prompt:\n${prompt}\n\nAssistant or tool summary:\n${responseText}\n\nCreate a concise session title.`,
      },
    ];
  }

  static async generate(args: GenerateChatSessionTitleInput & { llm: LlmAdapter }): Promise<string | undefined> {
    const result = await args.llm.chat(ChatSessionTitles.buildPrompt(args.prompt, args.responseText), []);
    return ChatSessionTitles.normalize(result.content);
  }

  static normalize(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value
      .replace(/[\r\n]+/g, ' ')
      .replace(/["'`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      return undefined;
    }

    return truncate(normalized, 48);
  }
}
