import type { LlmAdapter } from '../../../llm/types.js';

export function buildSessionAutoTitlePrompt(prompt: string, responseText: string) {
  return [
    {
      role: 'system' as const,
      content:
        'You name terminal chat sessions. Return only a short 3 to 6 word title in plain text. No quotes, no punctuation, no prefix.',
    },
    {
      role: 'user' as const,
      content: `User prompt:\n${prompt}\n\nAssistant or tool summary:\n${responseText}\n\nCreate a concise session title.`,
    },
  ];
}

export async function generateSessionTitle(args: {
  llm: LlmAdapter;
  prompt: string;
  responseText: string;
  normalize: (value: string | undefined) => string | undefined;
}) {
  const result = await args.llm.chat(buildSessionAutoTitlePrompt(args.prompt, args.responseText), []);
  return args.normalize(result.content);
}
