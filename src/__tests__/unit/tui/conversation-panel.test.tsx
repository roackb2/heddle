/** @vitest-environment jsdom */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isThinkingText, parseInlineSegments, parseMessageBlocks } from '../../../cli/chat/components/ConversationPanel.js';

describe('ConversationPanel markdown parsing', () => {
  it('parses stable markdown structures for assistant text', () => {
    const blocks = parseMessageBlocks([
      '# Heading',
      '',
      '- bullet item',
      '- [x] completed item',
      '1. numbered item',
      '> quoted line',
      '```ts',
      'const value = 42;',
      '```',
    ].join('\n'));

    expect(blocks).toEqual([
      { kind: 'heading', text: 'Heading' },
      { kind: 'blank', text: '' },
      { kind: 'bullet', text: 'bullet item' },
      { kind: 'task', marker: '[x]', text: 'completed item' },
      { kind: 'numbered', marker: '1.', text: 'numbered item' },
      { kind: 'quote', text: 'quoted line' },
      { kind: 'code', info: 'ts', text: 'const value = 42;' },
    ]);
  });

  it('keeps incomplete markdown readable while streaming', () => {
    const blocks = parseMessageBlocks([
      '**unfinished bold',
      '`unfinished code',
      '- [x',
      '```diff',
      '+added line',
    ].join('\n'));

    expect(blocks).toEqual([
      { kind: 'paragraph', text: '**unfinished bold `unfinished code' },
      { kind: 'bullet', text: '[x' },
      { kind: 'code', info: 'diff', text: '+added line' },
    ]);
  });

  it('parses inline segments conservatively when markdown is incomplete', () => {
    expect(parseInlineSegments('prefix **bold** `code` suffix')).toEqual([
      { kind: 'text', text: 'prefix ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ' suffix' },
    ]);

    expect(parseInlineSegments('prefix **unfinished and `still open')).toEqual([
      { kind: 'text', text: 'prefix ' },
      { kind: 'text', text: '**' },
      { kind: 'text', text: 'unfinished and ' },
      { kind: 'text', text: '`' },
      { kind: 'text', text: 'still open' },
    ]);
  });

  it('recognizes thinking-status text separately from assistant markdown content', () => {
    expect(isThinkingText('Thinking: planning the next step')).toBe(true);
    expect(isThinkingText('Thinking...')).toBe(true);
    expect(isThinkingText('# Heading\n- bullet')).toBe(false);
  });

  it('allows the streaming assistant surface to be rendered in jsdom without crashing', () => {
    const view = render(
      <div>
        {parseMessageBlocks('# Heading\n\n- bullet\n```ts\nconst x = 1\n```').map((block, index) => (
          <div key={`${block.kind}-${index}`}>{block.kind}</div>
        ))}
      </div>,
    );

    expect(view.container.textContent).toContain('heading');
    expect(view.container.textContent).toContain('bullet');
    expect(view.container.textContent).toContain('code');
  });
});
