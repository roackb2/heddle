import React from 'react';
import { Box, Text } from 'ink';
import type { ConversationLine } from '../state/types.js';
import type { PlanItem } from '../../../core/tools/toolkits/internal/update-plan.js';

export function ConversationPanel({
  messages,
  activeTurn,
}: {
  messages: ConversationLine[];
  activeTurn?: {
    title: string;
    lines: string[];
    error?: string;
    currentAssistantText?: string;
    currentPlan?: {
      explanation?: string;
      items: PlanItem[];
    };
  };
}) {
  const visibleMessages = messages.slice(-8);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conversation</Text>
      {visibleMessages.map((message, index) => (
        <ConversationEntry key={message.id} message={message} isLast={index === visibleMessages.length - 1} />
      ))}
      {activeTurn ?
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>┌ Heddle</Text>
          <Box paddingLeft={2} flexDirection="column">
            <Text color={activeTurn.error ? 'red' : 'yellow'}>{activeTurn.title}</Text>
            {activeTurn.lines.map((line) => (
              <Text key={line} dimColor>{line}</Text>
            ))}
            {activeTurn.currentAssistantText ?
              <Box marginTop={1}>
                <StreamingText text={activeTurn.currentAssistantText} />
              </Box>
            : null}
            {activeTurn.currentPlan ? <ActivePlanPanel plan={activeTurn.currentPlan} /> : null}
            {activeTurn.error ? <Text color="red">{activeTurn.error}</Text> : null}
          </Box>
          <Text dimColor>└</Text>
        </Box>
      : null}
    </Box>
  );
}

const ConversationEntry = React.memo(function ConversationEntry({
  message,
  isLast,
}: {
  message: ConversationLine;
  isLast: boolean;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>
        {message.role === 'user' ? `┌ You${message.isPending ? ' (queued)' : ''}` : '┌ Heddle'}
      </Text>
      <Box paddingLeft={2}>
        <MessageBody role={message.role} text={message.text} />
      </Box>
      <Text dimColor>
        {isLast ? '└' : '└────────────────────────────────────────────────────────'}
      </Text>
    </Box>
  );
});

function ActivePlanPanel({ plan }: { plan: { explanation?: string; items: PlanItem[] } }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">Current plan</Text>
      {plan.explanation ? <Text dimColor>{plan.explanation}</Text> : null}
      {plan.items.map((item) => (
        <Text key={`${item.status}-${item.step}`} color={taskTextColor(planStatusMarker(item.status), 'assistant')}>
          <Text color={taskMarkerColor(planStatusMarker(item.status))}>{planStatusMarker(item.status)} </Text>
          <InlineText text={item.step} color={taskTextColor(planStatusMarker(item.status), 'assistant')} />
        </Text>
      ))}
    </Box>
  );
}

function MessageBody({
  role,
  text,
}: {
  role: 'user' | 'assistant';
  text: string;
}) {
  const blocks = parseMessageBlocks(text);

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <React.Fragment key={`${block.kind}-${index}-${block.text}`}>
          {renderBlock(block, role)}
        </React.Fragment>
      ))}
    </Box>
  );
}

function StreamingText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} color="white">{line || ' '}</Text>
      ))}
    </Box>
  );
}

type MessageBlock =
  | { kind: 'blank'; text: '' }
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'task'; text: string; marker: '[ ]' | '[-]' | '[x]' }
  | { kind: 'numbered'; text: string; marker: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string; info?: string };

function parseMessageBlocks(text: string): MessageBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: MessageBlock[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeInfo: string | undefined;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        blocks.push({ kind: 'code', text: codeLines.join('\n'), info: codeInfo });
        codeLines = [];
        codeInfo = undefined;
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeInfo = line.trim().slice(3).trim() || undefined;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push({ kind: 'blank', text: '' });
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      blocks.push({ kind: 'heading', text: trimmed.replace(/^#{1,3}\s+/, '') });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const taskMatch = trimmed.match(/^[-*]\s+(\[(?: |x|-)\])\s+(.*)$/i);
      if (taskMatch) {
        const marker = normalizeTaskMarker(taskMatch[1]);
        if (marker) {
          blocks.push({ kind: 'task', marker, text: taskMatch[2] });
          continue;
        }
      }

      blocks.push({ kind: 'bullet', text: trimmed.replace(/^[-*]\s+/, '') });
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (numberedMatch) {
      blocks.push({ kind: 'numbered', marker: numberedMatch[1], text: numberedMatch[2] });
      continue;
    }

    if (/^>\s+/.test(trimmed)) {
      blocks.push({ kind: 'quote', text: trimmed.replace(/^>\s+/, '') });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: line });
  }

  if (codeLines.length > 0) {
    blocks.push({ kind: 'code', text: codeLines.join('\n'), info: codeInfo });
  }

  return collapseParagraphBlocks(blocks);
}

function collapseParagraphBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const collapsed: MessageBlock[] = [];

  for (const block of blocks) {
    const previous = collapsed.at(-1);
    if (block.kind === 'paragraph' && previous?.kind === 'paragraph') {
      previous.text = `${previous.text} ${block.text.trim()}`;
      continue;
    }

    collapsed.push(block);
  }

  return collapsed;
}

function renderBlock(
  block: MessageBlock,
  role: 'user' | 'assistant',
) {
  switch (block.kind) {
    case 'blank':
      return <Text>{' '}</Text>;
    case 'heading':
      return (
        <Text bold color={role === 'user' ? 'cyan' : 'green'}>
          <InlineText text={block.text} color={role === 'user' ? 'cyan' : 'green'} />
        </Text>
      );
    case 'bullet':
      return (
        <Text color={role === 'user' ? 'cyan' : 'white'}>
          <Text color="gray">• </Text>
          <InlineText text={block.text} color={role === 'user' ? 'cyan' : 'white'} />
        </Text>
      );
    case 'task':
      return (
        <Text color={taskTextColor(block.marker, role)}>
          <Text color={taskMarkerColor(block.marker)}>{block.marker} </Text>
          <InlineText text={block.text} color={taskTextColor(block.marker, role)} />
        </Text>
      );
    case 'numbered':
      return (
        <Text color={role === 'user' ? 'cyan' : 'white'}>
          <Text color="gray">{block.marker} </Text>
          <InlineText text={block.text} color={role === 'user' ? 'cyan' : 'white'} />
        </Text>
      );
    case 'quote':
      return (
        <Text color="gray">
          │ <InlineText text={block.text} color="gray" />
        </Text>
      );
    case 'code':
      return block.info === 'diff' ? <DiffCodeBlock text={block.text} /> : <PlainCodeBlock text={block.text} />;
    case 'paragraph':
      return (
        <Text color={role === 'user' ? 'cyan' : 'white'}>
          <InlineText text={block.text} color={role === 'user' ? 'cyan' : 'white'} />
        </Text>
      );
  }
}

function PlainCodeBlock({ text }: { text: string }) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} marginY={0}>
      <Text color="cyan">{text}</Text>
    </Box>
  );
}

function DiffCodeBlock({ text }: { text: string }) {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} marginY={0} flexDirection="column">
      {text.split('\n').map((line, index) => (
        <Text key={`diff-${index}-${line}`} color={diffLineColor(line)}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function diffLineColor(line: string): string | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'gray';
  }
  if (line.startsWith('@@')) {
    return 'yellow';
  }
  if (line.startsWith('+')) {
    return 'green';
  }
  if (line.startsWith('-')) {
    return 'red';
  }
  return 'white';
}

function InlineText({
  text,
  color,
}: {
  text: string;
  color: string;
}) {
  const segments = parseInlineSegments(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'code') {
          return (
            <Text key={`${segment.kind}-${index}-${segment.text}`} color="cyan">
              {segment.text}
            </Text>
          );
        }

        if (segment.kind === 'bold') {
          return (
            <Text key={`${segment.kind}-${index}-${segment.text}`} bold color={color}>
              {segment.text}
            </Text>
          );
        }

        return (
          <Text key={`${segment.kind}-${index}-${segment.text}`} color={color}>
            {segment.text}
          </Text>
        );
      })}
    </>
  );
}

function normalizeTaskMarker(value: string): '[ ]' | '[-]' | '[x]' | undefined {
  const normalized = value.toLowerCase();
  if (normalized === '[ ]') {
    return '[ ]';
  }
  if (normalized === '[-]') {
    return '[-]';
  }
  if (normalized === '[x]') {
    return '[x]';
  }
  return undefined;
}

function taskMarkerColor(marker: '[ ]' | '[-]' | '[x]'): string {
  if (marker === '[x]') {
    return 'green';
  }
  if (marker === '[-]') {
    return 'yellow';
  }
  return 'gray';
}

function taskTextColor(marker: '[ ]' | '[-]' | '[x]', role: 'user' | 'assistant'): string {
  if (role === 'user') {
    return 'cyan';
  }

  return marker === '[x]' ? 'green' : 'white';
}

function planStatusMarker(status: PlanItem['status']): '[ ]' | '[-]' | '[x]' {
  if (status === 'completed') {
    return '[x]';
  }
  if (status === 'in_progress') {
    return '[-]';
  }
  return '[ ]';
}

type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string };

function parseInlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let index = 0;

  while (index < text.length) {
    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2);
      if (end !== -1) {
        segments.push({ kind: 'bold', text: text.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end !== -1) {
        segments.push({ kind: 'code', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    const nextBold = text.indexOf('**', index);
    const nextCode = text.indexOf('`', index);
    const nextStopCandidates = [nextBold, nextCode].filter((candidate) => candidate !== -1);
    const nextStop = nextStopCandidates.length > 0 ? Math.min(...nextStopCandidates) : text.length;
    segments.push({ kind: 'text', text: text.slice(index, nextStop) });
    index = nextStop;
  }

  return segments.filter((segment) => segment.text.length > 0);
}
