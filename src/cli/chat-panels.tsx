import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ChatSession, ApprovalChoice, ConversationLine, LiveEvent, PendingApproval, TurnSummary } from './chat-types.js';
import { currentActivityText, formatApprovalHint, formatApprovalPrompt, truncate } from './chat-format.js';

const MAX_VISIBLE_INPUT_CHARS = 96;

export function ConversationPanel({ messages }: { messages: ConversationLine[] }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conversation</Text>
      {messages.slice(-8).map((message) => (
        <Box key={message.id} borderStyle="round" borderColor={message.role === 'user' ? 'cyan' : 'gray'} paddingX={1} marginBottom={1}>
          <Text color={message.role === 'user' ? 'cyan' : 'white'}>
            {message.role === 'user' ? 'You' : 'Heddle'}: {message.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function RecentTurnsPanel({ turns }: { turns: TurnSummary[] }) {
  const latestTurn = turns[turns.length - 1];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Recent Turns</Text>
      {!latestTurn ?
        <Text dimColor>No completed turns yet.</Text>
      : (
        <Box flexDirection="column">
          <Text color="magenta">{truncate(latestTurn.prompt, 120)}</Text>
          <Text dimColor>outcome={latestTurn.outcome} steps={latestTurn.steps} trace={latestTurn.traceFile}</Text>
          {latestTurn.outcome !== 'done' ? <Text color="red">{latestTurn.summary}</Text> : null}
          <Text dimColor>{latestTurn.events.slice(0, 4).map((event) => truncate(event, 160)).join(' • ')}</Text>
        </Box>
      )}
    </Box>
  );
}

export function ActivityPanel({
  isRunning,
  workingFrame,
  elapsedSeconds,
  liveEvents,
  pendingApproval,
  interruptRequested,
}: {
  isRunning: boolean;
  workingFrame: number;
  elapsedSeconds: number;
  liveEvents: LiveEvent[];
  pendingApproval?: PendingApproval;
  interruptRequested: boolean;
}) {
  const visibleEvents = isRunning ? liveEvents.slice(-3) : liveEvents.slice(-1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Current Activity</Text>
      <Text color={pendingApproval ? 'yellow' : interruptRequested ? 'yellow' : isRunning ? 'yellow' : 'gray'}>
        {currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested)}
      </Text>
      {visibleEvents.map((event) => (
        <Box key={event.id}>
          <Text dimColor>{truncate(event.text, 160)}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function ApprovalComposer({
  pendingApproval,
  approvalChoice,
}: {
  pendingApproval: PendingApproval;
  approvalChoice: ApprovalChoice;
}) {
  return (
    <>
      <Text color="white">{formatApprovalPrompt(pendingApproval)}</Text>
      <Text dimColor>{formatApprovalHint(pendingApproval)}</Text>
      <ApprovalSelector choice={approvalChoice} />
      <Box justifyContent="space-between">
        <Text dimColor>Use ←/→ then Enter</Text>
        <Text dimColor>Input paused during approval</Text>
      </Box>
    </>
  );
}

function ApprovalSelector({ choice }: { choice: ApprovalChoice }) {
  return (
    <Box marginBottom={0}>
      <Text color={choice === 'approve' ? 'green' : 'gray'}>
        {choice === 'approve' ? '◉ Approve' : '○ Approve'}
      </Text>
      <Text dimColor>   </Text>
      <Text color={choice === 'deny' ? 'red' : 'gray'}>
        {choice === 'deny' ? '◉ Deny' : '○ Deny'}
      </Text>
    </Box>
  );
}

export function PromptInput({
  value,
  isDisabled,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  isDisabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const [cursor, setCursor] = useState(value.length);

  useInput((input, key) => {
    if (isDisabled) {
      return;
    }

    if (key.return) {
      onSubmit(value);
      setCursor(0);
      return;
    }

    if ((key.meta && key.backspace) || (key.ctrl && input === 'u')) {
      onChange(value.slice(cursor));
      setCursor(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) {
        return;
      }

      onChange(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(cursor - 1);
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }

    if (key.home) {
      setCursor(0);
      return;
    }

    if (key.end) {
      setCursor(value.length);
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) {
      return;
    }

    if (!input) {
      return;
    }

    const nextInput = normalizePastedInput(input);
    onChange(value.slice(0, cursor) + nextInput + value.slice(cursor));
    setCursor(cursor + nextInput.length);
  }, { isActive: !isDisabled });

  if (!value) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return <Text>{buildPromptViewport(value, cursor)}</Text>;
}

export function SlashHintPanel({
  draft,
  activeSessionId,
  sessions,
}: {
  draft: string;
  activeSessionId: string;
  sessions: ChatSession[];
}) {
  const hints = getSlashHints(draft, activeSessionId, sessions).slice(0, 10);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Slash commands</Text>
      {hints.map((hint) => (
        <Text key={hint.command} dimColor>
          {hint.command} {hint.description}
        </Text>
      ))}
    </Box>
  );
}

export function CommandHintPanel({ draft }: { draft: string }) {
  const command = draft.trim().slice(1).trim();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Direct shell</Text>
      <Text dimColor>
        {command ?
          `Run ${truncate(command, 100)} directly in chat. Read-oriented commands stay in inspect mode; other commands fall back to approval-gated execution.`
        : 'Start with ! to run a shell command directly in chat.'}
      </Text>
    </Box>
  );
}

export function shouldShowSlashHints(draft: string): boolean {
  return draft.trimStart().startsWith('/');
}

export function shouldShowCommandHint(draft: string): boolean {
  return draft.trimStart().startsWith('!');
}

function getSlashHints(
  draft: string,
  activeSessionId: string,
  sessions: ChatSession[],
): Array<{ command: string; description: string }> {
  const base = [
    { command: '/help', description: 'show available local commands' },
    { command: '/model', description: 'show the active model' },
    { command: '/model <name>', description: 'switch the current model' },
    { command: '/models', description: 'list common model choices' },
    { command: '/continue', description: 'resume from the current transcript' },
    { command: '/clear', description: 'reset the current session transcript' },
    { command: '/session list', description: 'list local chat sessions' },
    { command: '/session new [name]', description: 'create and switch to a new session' },
    { command: '/session switch <id>', description: 'switch to another session' },
    { command: '/session continue <id>', description: 'switch to a session and resume it' },
    { command: '/session rename <name>', description: 'rename the current session' },
    { command: '/session close <id>', description: 'remove a saved session' },
  ];

  const trimmed = draft.trim();
  const filtered = base.filter((hint) => hint.command.startsWith(trimmed) || trimmed === '/');
  if (trimmed.startsWith('/session switch ')) {
    const sessionHints = sessions.map((session) => ({
      command: `/session switch ${session.id}`,
      description: `${session.id === activeSessionId ? '(current) ' : ''}${session.name}`,
    }));
    return sessionHints.filter((hint) => hint.command.startsWith(trimmed));
  }

  return filtered.length > 0 ? filtered : base;
}

function normalizePastedInput(input: string): string {
  return input.replace(/\r?\n+/g, ' ');
}

function buildPromptViewport(value: string, cursor: number): string {
  const withCursor = `${value.slice(0, cursor)}|${value.slice(cursor)}`;
  if (withCursor.length <= MAX_VISIBLE_INPUT_CHARS) {
    return withCursor;
  }

  const targetCursor = cursor + 1;
  const half = Math.floor(MAX_VISIBLE_INPUT_CHARS / 2);
  let start = Math.max(0, targetCursor - half);
  let end = Math.min(withCursor.length, start + MAX_VISIBLE_INPUT_CHARS);
  if (end - start < MAX_VISIBLE_INPUT_CHARS) {
    start = Math.max(0, end - MAX_VISIBLE_INPUT_CHARS);
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < withCursor.length ? '…' : '';
  const slice = withCursor.slice(start, end);
  return `${prefix}${slice}${suffix}`;
}
