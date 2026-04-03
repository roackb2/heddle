import React from 'react';
import { Box, Text } from 'ink';
import type { ChatSession } from '../state/types.js';

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

export function shouldShowSlashHints(draft: string): boolean {
  return draft.trimStart().startsWith('/');
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
