import type { ChatMessage } from '@/core/llm/types.js';
import { CompactionTranscriptRenderer } from '../transcript-renderer.js';
import { CONVERSATION_ARCHIVE_SUMMARIZER_SYSTEM_PROMPT } from './prompt.js';
import type { ConversationArchiveSummaryContext } from './types.js';

/**
 * Builds the exact prompt context the archive summarizer needs.
 */
export class ConversationArchiveSummarizerContextBuilder {
  static build(context: ConversationArchiveSummaryContext): ChatMessage[] {
    const transcript = CompactionTranscriptRenderer.render(context.archivedMessages, context.summaryModel);

    return [
      {
        role: 'system',
        content: CONVERSATION_ARCHIVE_SUMMARIZER_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          `Session: ${context.sessionId}`,
          `New archive path: ${context.archivePath}`,
          '',
          'Previous rolling summary:',
          context.previousRollingSummary?.trim() || '(none)',
          '',
          'Existing archive index JSON:',
          JSON.stringify(context.manifest.archives, null, 2),
          '',
          'Newly archived transcript:',
          transcript,
          '',
          'Produce the next cumulative rolling summary for the active history. Keep it concise enough for model context, but detailed enough that another agent can reconstruct the work state.',
        ].join('\n'),
      },
    ];
  }
}
