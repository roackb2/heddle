import type { ConversationActivity, ConversationCompactionStatus } from '@/core/live/index.js';
import type { TraceEvent } from '@/core/types.js';
import type { ConversationEngineHost } from '../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';

export type ConversationTextHostWriter = {
  write(text: string): void;
};

export type ConversationTextHostMode = 'off' | 'status' | 'verbose';

export type ConversationTextHostOptions = {
  output?: ConversationTextHostWriter | ((text: string) => void);
  activity?: ConversationTextHostMode;
  trace?: ConversationTextHostMode;
  compaction?: Exclude<ConversationTextHostMode, 'verbose'>;
  result?: Exclude<ConversationTextHostMode, 'verbose'>;
};

export type ConversationTextHost = {
  host: ConversationEngineHost;
  renderTurnResult(result: ConversationTurnResultSummary): void;
  formatActivity(activity: ConversationActivity): string | undefined;
  formatTraceEvent(event: TraceEvent): string | undefined;
  formatCompactionStatus(event: ConversationCompactionStatus): string | undefined;
  formatTurnResult(result: ConversationTurnResultSummary): string;
};
