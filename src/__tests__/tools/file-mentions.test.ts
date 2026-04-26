import { describe, expect, it } from 'vitest';
import {
  buildPromptWithFileMentions,
  filterMentionableFiles,
  getMentionQuery,
  insertMentionSelection,
} from '../../cli/chat/utils/file-mentions.js';

describe('file mentions', () => {
  it('detects a trailing mention query', () => {
    expect(getMentionQuery('Compare @REA')).toBe('REA');
    expect(getMentionQuery('hello world')).toBeUndefined();
    expect(getMentionQuery('test@example.com')).toBeUndefined();
  });

  it('inserts a selected file mention into the trailing token', () => {
    expect(insertMentionSelection('Compare @REA', 'README.md')).toBe('Compare @README.md');
  });

  it('ranks basename matches ahead of generic path substring matches', () => {
    const results = filterMentionableFiles(
      ['src/README-helper.ts', 'README.md', 'docs/guide.md'],
      'readme',
    );

    expect(results[0]).toBe('README.md');
  });

  it('builds a host note for resolved mentioned files without expanding file contents', () => {
    const result = buildPromptWithFileMentions(
      'Compare @README.md and @src/run-agent.ts',
      process.cwd(),
      ['README.md', 'src/run-agent.ts'],
    );

    expect(result.mentions).toEqual([
      { token: '@README.md', path: 'README.md', index: 8 },
      { token: '@src/run-agent.ts', path: 'src/run-agent.ts', index: 23 },
    ]);
    expect(result.runPrompt).toContain('Host note: the user referenced files inline with @mentions.');
    expect(result.runPrompt).toContain('1. @README.md -> README.md');
    expect(result.runPrompt).toContain('2. @src/run-agent.ts -> src/run-agent.ts');
    expect(result.runPrompt).toContain('Original user prompt:');
    expect(result.runPrompt).toContain('Compare @README.md and @src/run-agent.ts');
  });
});
