import { describe, expect, it, vi } from 'vitest';
import { ConversationEngineHostNormalizer } from '../../../core/chat/engine/turns/host/index.js';
import type { ToolCall, ToolDefinition } from '../../../core/types.js';

describe('conversation engine host normalizer', () => {
  it('normalizes tool approval requests for the run loop', async () => {
    const requestToolApproval = vi.fn(async () => ({ approved: true, reason: 'approved by host' }));
    const host = ConversationEngineHostNormalizer.normalize({
      approvals: {
        requestToolApproval,
      },
    }).turnHost;
    const call: ToolCall = { id: 'call-1', tool: 'edit_file', input: { path: 'README.md' } };
    const tool: ToolDefinition = {
      name: 'edit_file',
      description: 'Edit file',
      requiresApproval: true,
      parameters: { type: 'object' },
      async execute() {
        return { ok: true };
      },
    };

    await expect(host?.approveToolCall?.(call, tool)).resolves.toEqual({
      approved: true,
      reason: 'approved by host',
    });
    expect(requestToolApproval).toHaveBeenCalledWith({ call, tool });
  });

  it('fans out compaction status by phase through the normalized turn host', () => {
    const onStatus = vi.fn();
    const onPreflightCompactionStatus = vi.fn();
    const onFinalCompactionStatus = vi.fn();
    const host = ConversationEngineHostNormalizer.normalize({
      compaction: {
        onStatus,
        onPreflightCompactionStatus,
        onFinalCompactionStatus,
      },
    }).turnHost;
    const preflightEvent = {
      status: 'running' as const,
      archivePath: '.heddle/chat-sessions/session-1/archives/archive-preflight.jsonl',
    };
    const finalEvent = {
      status: 'finished' as const,
      archivePath: '.heddle/chat-sessions/session-1/archives/archive-final.jsonl',
      summaryPath: '.heddle/chat-sessions/session-1/summary.md',
    };

    host?.onCompactionStatus?.(preflightEvent, 'preflight');
    host?.onCompactionStatus?.(finalEvent, 'final');

    expect(onStatus).toHaveBeenCalledWith(preflightEvent);
    expect(onStatus).toHaveBeenCalledWith(finalEvent);
    expect(onPreflightCompactionStatus).toHaveBeenCalledWith(preflightEvent);
    expect(onFinalCompactionStatus).toHaveBeenCalledWith(finalEvent);
  });
});
