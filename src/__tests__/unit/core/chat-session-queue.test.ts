import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileConversationSessionService } from '@/core/chat/engine/sessions/service.js';
import type { CustomAgentExecutionSnapshot } from '@/core/custom-agents/index.js';

describe('chat session queued prompts', () => {
  it('preserves the selected custom-agent snapshot while queued and dequeued', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-chat-session-queue-'));
    const sessions = new FileConversationSessionService({
      workspaceRoot: root,
      stateRoot: join(root, '.heddle'),
      model: 'gpt-5.4',
    });
    const session = await sessions.create({ id: 'session-1', name: 'Session 1' });
    const agentSnapshot = askAgentSnapshot();

    const queued = await sessions.enqueuePrompt(session.id, {
      prompt: 'Review this change.',
      agentProfileId: 'builtin:review',
      agentSnapshot,
    });
    const dequeued = await sessions.dequeueQueuedPrompt(session.id);

    expect(queued.item.agentProfileId).toBe('builtin:review');
    expect(queued.item.agentSnapshot).toEqual(agentSnapshot);
    expect(dequeued.item).toEqual(expect.objectContaining({
      prompt: 'Review this change.',
      agentProfileId: 'builtin:review',
      agentSnapshot,
    }));
    expect(dequeued.session.queuedPrompts).toEqual([]);
  });
});

function askAgentSnapshot(): CustomAgentExecutionSnapshot {
  return {
    agentProfileId: 'builtin:review',
    agentName: 'Review',
    modeAlias: 'review',
    source: 'built-in',
    definitionHash: 'reviewhash',
    runtime: { maxSteps: 80 },
    toolProfile: {
      preset: 'inspect',
      includeTools: ['read_file', 'search_files', 'run_shell_inspect'],
      memoryMode: 'none',
    },
    approvalProfile: { preset: 'read_only' },
    systemContextAppendix: 'You are running in review mode.',
  };
}
