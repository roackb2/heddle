import { buildPromptRenderLines } from '../components/PromptInput.js';
import { getLocalCommandHints } from '../state/local-commands.js';
import type { ChatSession, ConversationLine, PendingApproval } from '../state/types.js';
import { formatApprovalHint, summarizePendingApproval, truncate } from '../utils/format.js';

type ActiveTurnSnapshot = {
  title: string;
  lines: string[];
  error?: string;
  currentAssistantText?: string;
};

export function buildTuiDebugSnapshot(args: {
  sessionName: string;
  activeModel: string;
  maxSteps: number;
  status: string;
  hint: string;
  contextStatus: string;
  sessionFooter: string;
  activeSessionId: string;
  sessions: ChatSession[];
  messages: ConversationLine[];
  activeTurn?: ActiveTurnSnapshot;
  pendingApproval?: PendingApproval;
  approvalChoice?: 'approve' | 'allow_project' | 'deny';
  draft: string;
  draftCursor: number;
  showSlashHints: boolean;
  showCommandHint: boolean;
  modelPicker?: {
    visible: boolean;
    query?: string;
    items: string[];
    highlightedIndex: number;
  };
  sessionPicker?: {
    visible: boolean;
    query?: string;
    items: Array<{ id: string; name: string }>;
    highlightedIndex: number;
  };
  fileMentionPicker?: {
    visible: boolean;
    query?: string;
    items: string[];
    highlightedIndex: number;
  };
}): string {
  const lines: string[] = [
    `Heddle • ${args.sessionName} • model=${args.activeModel} • steps=${args.maxSteps}`,
    `status=${args.status}`,
    args.hint,
    '',
    'Conversation',
  ];

  for (const message of args.messages.slice(-8)) {
    lines.push(message.role === 'user' ? `┌ You${message.isPending ? ' (queued)' : ''}` : '┌ Heddle');
    lines.push(...indentLines(renderMessageText(message.text)));
    lines.push('└');
    lines.push('');
  }

  if (args.activeTurn) {
    lines.push('┌ Heddle');
    lines.push(...indentLines([args.activeTurn.title, ...args.activeTurn.lines]));
    if (args.activeTurn.currentAssistantText) {
      lines.push(...indentLines(renderMessageText(args.activeTurn.currentAssistantText)));
    }
    if (args.activeTurn.error) {
      lines.push(...indentLines([`Error: ${args.activeTurn.error}`]));
    }
    lines.push('└');
    lines.push('');
  }

  if (args.pendingApproval) {
    const summary = summarizePendingApproval(args.pendingApproval);
    lines.push('Approval');
    lines.push(`Title: ${summary.title}`);
    if (summary.command) {
      lines.push(`Command: ${summary.command}`);
    }
    lines.push(`Scope: ${summary.scope}`);
    lines.push(`Capability: ${summary.capability}`);
    if (summary.risk) {
      lines.push(`Risk: ${summary.risk}`);
    }
    lines.push(`Why: ${summary.why}`);
    lines.push(`Hint: ${formatApprovalHint(args.pendingApproval)}`);
    lines.push(`Choice: ${args.approvalChoice ?? 'approve'}`);
    lines.push('');
  }

  if (args.showSlashHints) {
    lines.push('Slash commands');
    for (const hint of getLocalCommandHints(args.draft, args.activeSessionId, args.sessions).slice(0, 10)) {
      lines.push(`${hint.command} ${hint.description}`);
    }
    lines.push('');
  }

  if (args.showCommandHint) {
    const command = args.draft.trim().slice(1).trim();
    lines.push('Direct shell');
    lines.push(
      command ?
        `Run ${truncate(command, 100)} directly in chat. Read-oriented commands stay in inspect mode; other commands fall back to approval-gated execution.`
      : 'Start with ! to run a shell command directly in chat.',
    );
    lines.push('');
  }

  if (args.modelPicker?.visible) {
    lines.push('Model picker');
    lines.push(args.modelPicker.query ? `Search: ${args.modelPicker.query}` : 'Type after /model set to filter. Use ↑/↓ or Tab to choose.');
    lines.push(...renderPickerLines(args.modelPicker.items, args.modelPicker.highlightedIndex));
    lines.push('');
  }

  if (args.sessionPicker?.visible) {
    lines.push('Session picker');
    lines.push(args.sessionPicker.query ? `Search: ${args.sessionPicker.query}` : 'Type after /session choose to filter. Use ↑/↓ or Tab to choose.');
    lines.push(...renderPickerLines(
      args.sessionPicker.items.map((item, index) => `${index + 1}. ${item.name} [${item.id}]`),
      args.sessionPicker.highlightedIndex,
    ));
    lines.push('');
  }

  if (args.fileMentionPicker?.visible) {
    lines.push('File mentions');
    lines.push(args.fileMentionPicker.query ? `Search: ${args.fileMentionPicker.query}` : 'Type after @ to mention a file. Use ↑/↓ or Tab to choose.');
    lines.push(...renderPickerLines(args.fileMentionPicker.items, args.fileMentionPicker.highlightedIndex));
    lines.push('');
  }

  lines.push('Prompt');
  const promptLines =
    args.draft.length > 0 ?
      buildPromptRenderLines(args.draft, args.draftCursor, 8, 80).map((line) =>
        `${line.before}${line.hasCursor ? `[${line.cursor}]` : ''}${line.after}` || ' ',
      )
    : ['Ask Heddle about this project'];
  lines.push(...promptLines.map((line) => `> ${line}`));
  lines.push(args.draft.length > 0 ? `${args.draft.length} chars` : 'Enter to send');
  lines.push('');
  lines.push(`${args.contextStatus} • ${args.sessionFooter}`);

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderMessageText(text: string): string[] {
  const normalized = text.split(/\r?\n/);
  return normalized.length > 0 ? normalized : [''];
}

function renderPickerLines(items: string[], highlightedIndex: number): string[] {
  if (items.length === 0) {
    return ['No matching entries.'];
  }

  return items.slice(0, 8).map((item, index) => `${index === highlightedIndex ? '◉' : '○'} ${item}`);
}

function indentLines(lines: string[]): string[] {
  return lines.map((line) => `  ${line || ' '}`);
}
