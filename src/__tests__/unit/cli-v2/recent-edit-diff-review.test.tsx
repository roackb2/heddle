// @vitest-environment jsdom

import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecentEditDiffPanel } from '@/cli-v2/components/RecentEditDiffPanel.js';
import { useRecentEditDiffReview } from '@/cli-v2/hooks/useRecentEditDiffReview.js';
import type { ClientSharedRecentEditDiff } from '@/client-shared/services/session-activities/index.js';

describe('cli-v2 recent edit diff review', () => {
  it('shows a compact review summary by default', () => {
    const diffs = createDiffs(2);
    const { result } = renderHook(() => useRecentEditDiffReview(diffs));
    const view = render(
      <RecentEditDiffPanel
        diffs={diffs}
        review={result.current}
        running={false}
      />,
    );

    expect(view.container.textContent).toContain('Recent edits: 2 edits across 2 files');
    expect(view.container.textContent).toContain('run done');
    expect(view.container.textContent).toContain('type /d to review');
    expect(view.container.textContent).not.toContain('@@ -1,2 +1,2 @@');
  });

  it('summarizes repeated edits without overstating changed files', () => {
    const diffs = createDiffs(2).map((diff) => ({ ...diff, path: 'src/shared.ts' }));
    const { result } = renderHook(() => useRecentEditDiffReview(diffs));
    const view = render(
      <RecentEditDiffPanel
        diffs={diffs}
        review={result.current}
        running={false}
      />,
    );

    expect(view.container.textContent).toContain('2 edits across 1 file');
  });

  it('renders one selected file in review mode', () => {
    const diffs = createDiffs(2);
    const { result } = renderHook(() => useRecentEditDiffReview(diffs));

    act(() => {
      result.current.open();
      result.current.next();
    });

    const view = render(
      <RecentEditDiffPanel
        diffs={diffs}
        review={result.current}
        running
      />,
    );

    expect(view.container.textContent).toContain('Diff review');
    expect(view.container.textContent).toContain('[2/2] src/file-2.ts');
    expect(view.container.textContent).toContain('@@ -1,2 +1,2 @@');
    expect(view.container.textContent).toContain('+const value2 = true;');
    expect(view.container.textContent).not.toContain('src/file-1.ts');
  });

  it('opens only through explicit review mode actions', () => {
    const { result } = renderHook(() => useRecentEditDiffReview(createDiffs(1)));

    expect(result.current.mode).toBe('summary');

    act(() => {
      result.current.open();
    });
    expect(result.current.mode).toBe('review');
  });

  it('moves through files and closes from review keyboard input', () => {
    const { result } = renderHook(() => useRecentEditDiffReview(createDiffs(3)));

    act(() => {
      result.current.open();
    });

    act(() => {
      expect(result.current.handleReviewKey('n', {})).toBe(true);
    });
    expect(result.current.selectedIndex).toBe(1);

    act(() => {
      expect(result.current.handleReviewKey('k', {})).toBe(true);
    });
    expect(result.current.selectedIndex).toBe(0);

    act(() => {
      expect(result.current.handleReviewKey('', { escape: true })).toBe(true);
    });
    expect(result.current.mode).toBe('summary');
  });
});

function createDiffs(count: number): ClientSharedRecentEditDiff[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `run-1:tool-${number}`,
      runId: 'run-1',
      step: number,
      toolCallId: `tool-${number}`,
      path: `src/file-${number}.ts`,
      action: 'replace',
      patch: [
        '@@ -1,2 +1,2 @@',
        `-const value${number} = false;`,
        `+const value${number} = true;`,
      ].join('\n'),
      truncated: false,
      timestamp: '2026-06-05T00:00:00.000Z',
    };
  });
}
