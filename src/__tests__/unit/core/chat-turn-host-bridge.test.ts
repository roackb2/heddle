import { describe, expect, it, vi } from 'vitest';
import { createChatTurnHostBridge } from '../../../core/chat/engine/turns/host-bridge.js';
import type { ToolCall, ToolDefinition } from '../../../core/types.js';

describe('chat turn host bridge', () => {
  it('fans out preflight compaction status to both legacy and host callbacks', () => {
    const onLegacyCompactionStatus = vi.fn();
    const onPreflightCompactionStatus = vi.fn();
    const bridge = createChatTurnHostBridge({
      onCompactionStatus: onLegacyCompactionStatus,
      host: {
        compaction: {
          onPreflightCompactionStatus,
        },
      },
    });
    const event = {
      status: 'running' as const,
      archivePath: '.heddle/chat-sessions/session-1/archives/archive-preflight.jsonl',
    };

    bridge.notifyPreflightCompactionStatus(event);

    expect(onLegacyCompactionStatus).toHaveBeenCalledWith(event);
    expect(onPreflightCompactionStatus).toHaveBeenCalledWith(event);
  });

  it('fans out final compaction status to both legacy and host callbacks', () => {
    const onLegacyCompactionStatus = vi.fn();
    const onFinalCompactionStatus = vi.fn();
    const bridge = createChatTurnHostBridge({
      onCompactionStatus: onLegacyCompactionStatus,
      host: {
        compaction: {
          onFinalCompactionStatus,
        },
      },
    });
    const event = {
      status: 'finished' as const,
      archivePath: '.heddle/chat-sessions/session-1/archives/archive-final.jsonl',
      summaryPath: '.heddle/chat-sessions/session-1/summary.md',
    };

    bridge.notifyFinalCompactionStatus(event);

    expect(onLegacyCompactionStatus).toHaveBeenCalledWith(event);
    expect(onFinalCompactionStatus).toHaveBeenCalledWith(event);
  });

  it('normalizes tool approval requests for the run loop', async () => {
    const requestToolApproval = vi.fn(async () => ({ approved: true, reason: 'approved by host' }));
    const bridge = createChatTurnHostBridge({
      host: {
        approvals: {
          requestToolApproval,
        },
      },
    });
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

    await expect(bridge.approveToolCall?.(call, tool)).resolves.toEqual({
      approved: true,
      reason: 'approved by host',
    });
    expect(requestToolApproval).toHaveBeenCalledWith({ call, tool });
  });
});
