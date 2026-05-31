/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentPlanPanel } from '../../../web-v2/components/conversation/AgentPlanPanel.js';
import type { ClientSharedSessionPlan } from '../../../client-shared/services/session-activities/index.js';

describe('AgentPlanPanel', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the current plan summary and items', () => {
    const plan = createPlan();

    render(
      <AgentPlanPanel plan={plan} />,
    );

    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getAllByText('Implement plan UI')).toHaveLength(2);
    expect(screen.getByText('Inspect current path')).toBeTruthy();
    expect(screen.getByText('Verify behavior')).toBeTruthy();
    expect(screen.getByText('Plan').closest('details')?.open).toBe(true);
  });

  it('defaults collapsed on mobile and can be expanded', () => {
    mockMobileViewport();

    render(<AgentPlanPanel plan={createPlan()} />);

    const details = screen.getByText('Plan').closest('details');
    expect(details?.open).toBe(false);

    fireEvent.click(screen.getByText('Plan'));

    expect(details?.open).toBe(true);
  });
});

function createPlan(): ClientSharedSessionPlan {
  return {
    source: 'agent-loop',
    type: 'plan.updated',
    runId: 'run-1',
    step: 1,
    timestamp: new Date().toISOString(),
    explanation: 'Tracking current work.',
    items: [
      { step: 'Inspect current path', status: 'completed' },
      { step: 'Implement plan UI', status: 'in_progress' },
      { step: 'Verify behavior', status: 'pending' },
    ],
  };
}

function mockMobileViewport(): void {
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches: query === '(max-width: 38rem)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}
