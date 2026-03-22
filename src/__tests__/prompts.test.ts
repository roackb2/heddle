import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompts/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('encourages brief rationale before tool use', () => {
    const prompt = buildSystemPrompt('Inspect the repo', ['list_files', 'read_file']);

    expect(prompt).toContain('Before calling tools, briefly state what you are about to check');
    expect(prompt).toContain('Use tools purposefully');
    expect(prompt).toContain('Start from the current workspace and nearby context');
    expect(prompt).toContain('Do not invent extra fields');
    expect(prompt).toContain('inspect that directly before using broad text search');
    expect(prompt).toContain('prefer primary sources such as implementation artifacts, tool definitions, or direct system evidence over higher-level summaries');
    expect(prompt).toContain('If a tool reports invalid input or suggests a better tool, correct the call immediately');
  });
});
