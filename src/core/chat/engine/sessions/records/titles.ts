/**
 * Pure session-title generation behavior.
 *
 * Owns the prompt and LLM call used to suggest a short chat session title.
 * Storage and host auto-rename policy stay outside this class.
 */
import type { ChatMessage, LlmAdapter } from '../../../../llm/types.js';
import type { GenerateChatSessionTitleInput } from './types.js';

export class ChatSessionTitles {
  static buildPrompt(prompt: string, responseText: string): ChatMessage[] {
    return [
      {
        role: 'system',
        content:
          'You name terminal chat sessions. Return only a short 3 to 6 word title in plain text. No quotes, no punctuation, no prefix.',
      },
      {
        role: 'user',
        content: `User prompt:\n${prompt}\n\nAssistant or tool summary:\n${responseText}\n\nCreate a concise session title.`,
      },
    ];
  }

  static async generate(args: GenerateChatSessionTitleInput & { llm: LlmAdapter }): Promise<string | undefined> {
    const result = await args.llm.chat(ChatSessionTitles.buildPrompt(args.prompt, args.responseText), []);
    return args.normalize(result.content);
  }
}
