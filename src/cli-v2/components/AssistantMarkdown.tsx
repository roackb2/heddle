import React from 'react';
import chalk from 'chalk';
import { Text } from 'ink';
import { lexer, parser } from 'marked';
import type { MarkedOptions } from 'marked';
import TerminalRenderer from 'marked-terminal';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

/**
 * TUI-owned Markdown presentation for assistant text.
 *
 * Conversation/session state stores plain Markdown text. The terminal surface
 * owns how that text is rendered, while core and control-plane APIs stay
 * renderer-agnostic.
 */
export function AssistantMarkdown({ children }: { children: string }) {
  return <Text>{renderTerminalMarkdown(children)}</Text>;
}

const terminalMarkdownRenderer = new TerminalRenderer({
  reflowText: false,
  showSectionPrefix: true,
  tab: 2,
});

const renderCodeBlock = terminalMarkdownRenderer.code.bind(terminalMarkdownRenderer);

terminalMarkdownRenderer.code = (code: string, language?: string, escaped?: boolean) => {
  const renderedCode = renderCodeBlock(code, language, escaped ?? false).trimEnd();
  return `${styleCodeBlock(renderedCode)}\n\n`;
};

function styleCodeBlock(renderedCode: string): string {
  const lines = renderedCode.split('\n');
  const width = Math.max(...lines.map(measureTerminalLine), 1);
  return lines.map((line) => styleCodeLine(line, width)).join('\n');
}

function styleCodeLine(line: string, width: number): string {
  const padding = ' '.repeat(Math.max(0, width - measureTerminalLine(line)));
  return chalk.hex('#b8c0d0').bgHex('#243047')(` ${line}${padding} `);
}

function measureTerminalLine(line: string): number {
  return stringWidth(stripAnsi(line));
}

function renderTerminalMarkdown(markdownText: string): string {
  // marked-terminal's published types lag marked's renderer signature, but the
  // runtime renderer contract is compatible with marked.parser.
  return parser(lexer(markdownText), {
    renderer: terminalMarkdownRenderer as unknown as MarkedOptions['renderer'],
  }).trim();
}
