import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../core/prompts/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('frames Heddle as a coding and workspace agent rather than a generic chatbot', () => {
    const prompt = buildSystemPrompt('Explain this project.', ['list_files', 'read_file', 'run_shell_inspect']);

    expect(prompt).toContain('You are Heddle, a conversational coding and workspace agent.');
    expect(prompt).toContain('You are not a generic chatbot.');
    expect(prompt).toContain('## Default Workflow');
    expect(prompt).toContain('1. Clarify the real task.');
    expect(prompt).toContain('2. Gather the minimum relevant evidence first.');
    expect(prompt).toContain('3. Form a grounded conclusion or proposal.');
    expect(prompt).toContain('4. Carry the task through when action is needed.');
    expect(prompt).toContain('5. Finish with a useful operator answer.');
    expect(prompt).toContain('If the user asks what Heddle itself is');
    expect(prompt).toContain('If the user asks how to use Heddle');
    expect(prompt).toContain('direct shell commands');
    expect(prompt).toContain('distinguish observed facts from inference');
    expect(prompt).toContain('Use report_state only when you are genuinely blocked');
    expect(prompt).toContain('When you have enough evidence to continue, continue.');
    expect(prompt).toContain('For bounded implementation work, carry the current slice through until it is actually complete or honestly blocked');
    expect(prompt).toContain('Do not lead with internal tool names or implementation details');
    expect(prompt).toContain('prefer plain-language descriptions over enumerating internal tool names');
    expect(prompt).toContain('prefer carrying the task through implementation and verification instead of stopping at analysis or a plan unless you are blocked');
    expect(prompt).toContain('If the user asks to improve tests or coverage');
    expect(prompt).toContain('Prefer the first-class file editing tool for creating or changing file contents');
    expect(prompt).not.toContain('## Heddle-Managed Memory Domain');
    expect(prompt).toContain('If a shell command is arbitrary, uses inline scripts, needs redirects/heredocs, or inspect rejects it, switch to run_shell_mutate');
    expect(prompt).toContain('do not stop at "inspect is blocked."');
    expect(prompt).toContain('Do not ask unnecessary questions when the answer can be discovered from the workspace');
    expect(prompt).toContain('Do not jump from one narrow local detail to a project-level recommendation');
    expect(prompt).toContain('If the user asks for the next step, propose a concrete high-leverage next step based on the project goal and current state');
    expect(prompt).toContain('If you identify a reasonable bounded change that directly serves the user goal, make it and verify it instead of only describing it.');
    expect(prompt).toContain('Once you choose a concrete next step, execute that step instead of repeatedly restating the plan');
    expect(prompt).toContain('Do not spend multiple turns narrating the same intent without either gathering new evidence or making progress on the implementation.');
    expect(prompt).toContain('record a short plan with update_plan');
    expect(prompt).toContain('If you recorded a plan, do not stop after only one small slice');
    expect(prompt).toContain('Use update_plan for substantial tasks');
  });

  it('includes project-specific context when provided', () => {
    const prompt = buildSystemPrompt('Help in this repo.', ['list_files'], 'Source: AGENTS.md\nUse yarn and keep answers concise.');

    expect(prompt).toContain('## Project Context');
    expect(prompt).toContain('Source: AGENTS.md');
    expect(prompt).toContain('Use yarn and keep answers concise.');
  });
});
