import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import { EngineConversationTurnService } from '@/core/chat/engine/turns/service.js';
import type { AgentLoopEvent } from '@/core/runtime/loop/index.js';
import { ConversationAgentService } from '@/sdk/conversation/headless/index.js';

describe('ConversationAgentService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(EngineConversationTurnService, 'run').mockImplementation(async (args) => {
      const event: AgentLoopEvent = {
        source: 'agent-loop',
        type: 'assistant.stream',
        runId: 'run-1',
        step: 1,
        text: 'structured partial',
        done: false,
        timestamp: '2026-07-19T00:00:00.000Z',
      };
      args.host?.onEvent(event);
      const session = await args.sessionRepository?.read(args.sessionId);

      return {
        outcome: 'done',
        summary: 'Structured answer',
        session: session?.session,
        artifacts: [],
        toolResults: [],
      } as Awaited<ReturnType<typeof EngineConversationTurnService.run>>;
    });
  });

  it('owns defaults, stable session ensure, activity capture, and structured turn output', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-conversation-agent-'));
    const onActivity = vi.fn();
    const agent = new ConversationAgentService({
      credentialPreflight: false,
      env: {},
      host: { events: { onActivity } },
      maxSteps: 7,
      model: 'gpt-test',
      session: {
        id: 'project-assistant',
        name: 'Project assistant',
      },
      workspaceRoot,
    });

    const first = await agent.send({ prompt: '  Summarize this project.  ' });
    const second = await agent.send({ prompt: 'Continue.' });

    expect(agent.runtime).toEqual(expect.objectContaining({
      maxSteps: 7,
      memoryMaintenanceMode: 'none',
      model: 'gpt-test',
      stateRoot: join(workspaceRoot, '.heddle'),
      workspaceRoot,
    }));
    expect(first).toEqual(expect.objectContaining({
      outcome: 'done',
      summary: 'Structured answer',
      sessionCreated: true,
      session: expect.objectContaining({
        id: 'project-assistant',
        name: 'Project assistant',
      }),
      activities: [expect.objectContaining({
        type: 'assistant.stream',
        text: 'structured partial',
      })],
    }));
    expect(second.sessionCreated).toBe(false);
    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(EngineConversationTurnService.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        maxSteps: 7,
        memoryMaintenanceMode: 'none',
        prompt: 'Summarize this project.',
        sessionId: 'project-assistant',
      }),
    );
  });

  it('uses the same generic defaults as the CLI starter', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-conversation-agent-defaults-'));
    const agent = new ConversationAgentService({
      credentialPreflight: false,
      env: {},
      workspaceRoot,
    });

    expect(agent.runtime).toEqual({
      memoryMaintenanceMode: 'none',
      model: DEFAULT_OPENAI_MODEL,
      reasoningEffort: undefined,
      stateRoot: join(workspaceRoot, '.heddle'),
      workspaceRoot,
    });
  });

  it('rejects an empty prompt before creating the default session', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-conversation-agent-empty-'));
    const agent = new ConversationAgentService({
      credentialPreflight: false,
      env: {},
      model: 'gpt-test',
      workspaceRoot,
    });

    await expect(agent.send({ prompt: '   ' })).rejects.toThrow(
      'Conversation agent prompt cannot be empty.',
    );
    await expect(agent.engine.sessions.listExisting()).resolves.toEqual([]);
  });
});
