/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActivityStatus } from '../../../web-v2/components/conversation/AgentActivityStatus.js';

describe('AgentActivityStatus', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders current activity with elapsed time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T07:00:12.000Z'));

    render(
      <AgentActivityStatus
        currentActivity={{
          label: 'Thinking',
          startedAt: '2026-05-31T07:00:00.000Z',
          tone: 'info',
        }}
      />,
    );

    expect(screen.getByTestId('web-v2-agent-activity-status').textContent).toContain('Thinking');
    expect(screen.getByTestId('web-v2-agent-activity-status').textContent).toContain('12s');
  });
});
