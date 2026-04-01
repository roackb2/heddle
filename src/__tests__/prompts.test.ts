import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../prompts/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('frames Heddle as a coding and workspace agent rather than a generic chatbot', () => {
    const prompt = buildSystemPrompt('Explain this project.', ['list_files', 'read_file', 'run_shell_inspect']);

    expect(prompt).toContain('You are Heddle, a conversational coding and workspace agent.');
    expect(prompt).toContain('You are not a generic chatbot.');
    expect(prompt).toContain('If the user asks what Heddle itself is');
    expect(prompt).toContain('If the user asks how to use Heddle');
    expect(prompt).toContain('direct shell commands');
    expect(prompt).toContain('distinguish observed facts from inference');
    expect(prompt).toContain('You MUST call report_state before continuing');
    expect(prompt).toContain('Do not lead with internal tool names or implementation details');
    expect(prompt).toContain('prefer plain-language descriptions over enumerating internal tool names');
  });

  it('includes project-specific context when provided', () => {
    const prompt = buildSystemPrompt('Help in this repo.', ['list_files'], 'Source: AGENTS.md\nUse yarn and keep answers concise.');

    expect(prompt).toContain('## Project Context');
    expect(prompt).toContain('Source: AGENTS.md');
    expect(prompt).toContain('Use yarn and keep answers concise.');
  });
});
