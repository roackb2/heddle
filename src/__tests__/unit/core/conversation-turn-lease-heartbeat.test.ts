import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_LEASE_REFRESH_INTERVAL_MS,
  type ChatSessionLeaseClaim,
} from '@/core/chat/engine/sessions/leases/index.js';
import { ConversationTurnLeaseHeartbeatService } from '@/core/chat/engine/turns/lease/index.js';

const leaseClaim: ChatSessionLeaseClaim = {
  hostId: 'test-host',
  ownerId: 'test-owner',
  fencingToken: 1,
};

describe('ConversationTurnLeaseHeartbeatService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews an acquired claim until stopped', async () => {
    vi.useFakeTimers();
    const refreshLease = vi.fn().mockResolvedValue(undefined);
    const heartbeat = new ConversationTurnLeaseHeartbeatService({
      sessionService: { refreshLease },
      sessionId: 'session-1',
    });

    heartbeat.start(leaseClaim);
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_REFRESH_INTERVAL_MS * 3);

    expect(refreshLease).toHaveBeenCalledTimes(3);
    expect(refreshLease).toHaveBeenNthCalledWith(1, 'session-1', leaseClaim);

    await heartbeat.stop();
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_REFRESH_INTERVAL_MS);
    expect(refreshLease).toHaveBeenCalledTimes(3);
  });

  it('does not overlap refreshes when persistence is slow', async () => {
    vi.useFakeTimers();
    let finishRefresh: (() => void) | undefined;
    const refreshLease = vi.fn(async () => await new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));
    const heartbeat = new ConversationTurnLeaseHeartbeatService({
      sessionService: { refreshLease },
      sessionId: 'session-1',
    });

    heartbeat.start(leaseClaim);
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_REFRESH_INTERVAL_MS * 3);
    expect(refreshLease).toHaveBeenCalledTimes(1);

    finishRefresh?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_REFRESH_INTERVAL_MS);
    expect(refreshLease).toHaveBeenCalledTimes(2);

    finishRefresh?.();
    await heartbeat.stop();
  });

  it('aborts the turn signal and preserves the lease error when renewal fails', async () => {
    vi.useFakeTimers();
    const failure = new Error('lease refresh failed');
    const heartbeat = new ConversationTurnLeaseHeartbeatService({
      sessionService: {
        refreshLease: vi.fn().mockRejectedValue(failure),
      },
      sessionId: 'session-1',
    });

    heartbeat.start(leaseClaim);
    await vi.advanceTimersByTimeAsync(SESSION_LEASE_REFRESH_INTERVAL_MS);

    expect(heartbeat.signal.aborted).toBe(true);
    expect(heartbeat.signal.reason).toBe(failure);
    expect(() => heartbeat.throwIfFailed()).toThrow(failure);
    await heartbeat.stop();
  });
});
