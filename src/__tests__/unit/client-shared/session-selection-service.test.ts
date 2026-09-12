import { describe, expect, it } from 'vitest';
import type { ControlPlaneSessionView } from '../../../client-shared/api/types.js';
import { ClientSharedSessionSelectionService } from '../../../client-shared/services/session-selection/index.js';

describe('ClientSharedSessionSelectionService', () => {
  it('resumes the most recently updated session instead of the first pinned session', () => {
    const pinned = session({
      id: 'pinned-old',
      pinned: true,
      updatedAt: '2026-08-28T09:00:00.000Z',
    });
    const recent = session({
      id: 'recent-work',
      updatedAt: '2026-08-29T09:00:00.000Z',
    });

    expect(ClientSharedSessionSelectionService.resolveStartupSession([pinned, recent])).toBe(recent);
    expect(ClientSharedSessionSelectionService.resolveStartupSession([recent, pinned])).toBe(recent);
  });

  it('falls back to creation time and resolves ties independently of pinned display order', () => {
    const pinned = session({
      id: 'z-pinned',
      pinned: true,
      updatedAt: 'invalid',
      createdAt: '2026-08-29T09:00:00.000Z',
    });
    const recent = session({
      id: 'a-recent',
      createdAt: '2026-08-29T09:00:00.000Z',
    });

    expect(ClientSharedSessionSelectionService.resolveStartupSession([pinned, recent])).toBe(recent);
    expect(ClientSharedSessionSelectionService.resolveStartupSession([recent, pinned])).toBe(recent);
  });

  it('returns undefined when no session is available', () => {
    expect(ClientSharedSessionSelectionService.resolveStartupSession([])).toBeUndefined();
  });
});

function session(overrides: Partial<ControlPlaneSessionView>): ControlPlaneSessionView {
  return {
    id: 'session-1',
    name: 'Session 1',
    pinned: false,
    messageCount: 0,
    turnCount: 0,
    queuedPromptCount: 0,
    ...overrides,
  };
}
