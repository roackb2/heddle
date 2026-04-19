import { Fragment, memo, type ReactNode } from 'react';

import type { ChatSessionDetail } from '../../../lib/api';
import { className } from '../utils';
import { Pill } from './common';

type ChatMessage = Exclude<ChatSessionDetail, null>['messages'][number];

type ParsedToolResult = {
  tool: string;
  ok?: boolean;
  command?: string;
  output?: unknown;
  error?: string;
};

export const ConversationMessage = memo(function ConversationMessage({ message }: { message: ChatMessage }) {
  const isWorking = message.role === 'assistant' && (message.isPending || message.isStreaming);
  const toolResult = message.role === 'assistant' ? parseToolResultMessage(message.text) : undefined;
  return (
    <article className={className('message', message.role === 'user' ? 'user' : 'assistant', toolResult && 'tool-result', isWorking && 'working')}>
      <div className="message-header">
        <span>{message.role === 'user' ? 'You' : toolResult ? 'Tool result' : 'Heddle'}</span>
        <div className="pills compact-pills">
          {toolResult ? <Pill tone={toolResult.ok === false ? 'bad' : 'good'}>{toolResult.tool}</Pill> : null}
          {message.isPending ? <Pill tone="warn">working</Pill> : null}
          {message.isStreaming ? <Pill>live</Pill> : null}
        </div>
      </div>
      <div className={className('message-body', message.role === 'assistant' && 'markdown-body')}>
        {toolResult ? <ToolResultBody result={toolResult} />
        : message.role === 'assistant' ? renderSimpleMarkdown(message.text)
        : message.text}
      </div>
    </article>
  );
});

function ToolResultBody({ result }: { result: ParsedToolResult }) {
  const output = formatToolOutput(result.output);
  return (
    <div className="tool-result-body">
      <div className="tool-result-meta">
        <Pill tone={result.ok === false ? 'bad' : 'good'}>{result.ok === false ? 'failed' : 'completed'}</Pill>
        {result.command ? <span className="tool-command">{result.command}</span> : null}
      </div>
      {result.error ? <p className="tool-error">{result.error}</p> : null}
      {output ? <pre className="tool-output">{output}</pre> : <p className="muted">No visible output.</p>}
    </div>
  );
}

function parseToolResultMessage(text: string): ParsedToolResult | undefined {
  const match = text.match(/^([a-z][a-z0-9_]*):\s*([\s\S]*)$/);
  if (!match) {
    return undefined;
  }

  const [, tool, rawPayload] = match;
  if (!isKnownToolName(tool)) {
    return undefined;
  }

  const payload = parseJsonPayload(rawPayload.trim());
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { tool, output: rawPayload.trim() };
  }

  const record = payload as Record<string, unknown>;
  const output = record.output;
  const outputRecord = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : undefined;
  return {
    tool,
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    command: typeof outputRecord?.command === 'string' ? outputRecord.command : undefined,
    output: outputRecord?.stdout ?? outputRecord?.output ?? output,
    error: typeof record.error === 'string' ? record.error : typeof outputRecord?.stderr === 'string' && !outputRecord.stdout ? outputRecord.stderr : undefined,
  };
}

function parseJsonPayload(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function formatToolOutput(output: unknown): string | undefined {
  if (output === undefined || output === null) {
    return undefined;
  }

  if (typeof output === 'string') {
    return output.trim() || undefined;
  }

  return JSON.stringify(output, null, 2);
}

function isKnownToolName(value: string): boolean {
  return [
    'edit_file',
    'edit_memory_note',
    'list_files',
    'read_file',
    'report_state',
    'run_shell_inspect',
    'run_shell_mutate',
    'search_files',
    'search_memory_notes',
    'update_plan',
    'view_image',
    'web_search',
  ].includes(value);
}

function renderSimpleMarkdown(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: Array<{ checked?: boolean; content: string }> = [];
  let orderedItems: string[] = [];
  let codeFence: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }
    nodes.push(<p key={`p-${nodes.length}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    nodes.push(
      <ul key={`ul-${nodes.length}`}>
        {listItems.map((item, index) => (
          <li key={index}>
            {typeof item.checked === 'boolean' ?
              <>
                <input type="checkbox" checked={item.checked} readOnly disabled />{' '}
              </>
            : null}
            {renderInlineMarkdown(item.content)}
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  const flushOrdered = () => {
    if (!orderedItems.length) {
      return;
    }
    nodes.push(
      <ol key={`ol-${nodes.length}`}>
        {orderedItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
      </ol>,
    );
    orderedItems = [];
  };

  const flushCodeFence = () => {
    if (!codeFence) {
      return;
    }
    nodes.push(<pre key={`code-${nodes.length}`} className="code-block"><code>{codeFence.join('\n')}</code></pre>);
    codeFence = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      flushOrdered();
      if (codeFence) {
        flushCodeFence();
      } else {
        codeFence = [];
      }
      continue;
    }

    if (codeFence) {
      codeFence.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushOrdered();
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2] ?? '');
      if (level === 1) {
        nodes.push(<h1 key={`h1-${nodes.length}`}>{content}</h1>);
      } else if (level === 2) {
        nodes.push(<h2 key={`h2-${nodes.length}`}>{content}</h2>);
      } else if (level === 3) {
        nodes.push(<h3 key={`h3-${nodes.length}`}>{content}</h3>);
      } else {
        nodes.push(<h4 key={`h4-${nodes.length}`}>{content}</h4>);
      }
      continue;
    }

    const checklist = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (checklist) {
      flushParagraph();
      flushOrdered();
      listItems.push({ checked: checklist[1].toLowerCase() === 'x', content: checklist[2] ?? '' });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      flushOrdered();
      listItems.push({ content: bullet[1] ?? '' });
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      flushList();
      orderedItems.push(ordered[1] ?? '');
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushOrdered();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushOrdered();
  flushCodeFence();

  return nodes.length ? nodes : markdown;
}

function renderInlineMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(<code key={`code-${match.index}`} className="inline-code">{match[1]}</code>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>);
}
