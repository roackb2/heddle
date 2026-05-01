import { describe, expect, it } from 'vitest';
import { buildHeddleAskCommand } from '../../core/eval/agent-runner.js';

describe('buildHeddleAskCommand', () => {
  it('uses yarn script arguments that work across Yarn classic and Berry', () => {
    expect(buildHeddleAskCommand({
      workspaceRoot: '/tmp/heddle-eval-workspace',
      model: 'gpt-5.4',
      maxSteps: 120,
      prompt: 'Do the work.',
      sessionName: 'eval-case',
      preferApiKey: true,
    })).toEqual([
      'yarn',
      'cli:dev',
      '--cwd',
      '/tmp/heddle-eval-workspace',
      '--force-owner-conflict',
      '--model',
      'gpt-5.4',
      '--max-steps',
      '120',
      '--prefer-api-key',
      'ask',
      '--new-session',
      'eval-case',
      'Do the work.',
    ]);
  });
});
