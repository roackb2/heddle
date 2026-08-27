/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SubagentActivityPanel } from '@/web-v2/components/conversation/SubagentActivityPanel.js';
import { I18nProvider } from '@/web-v2/i18n/I18nProvider.js';

describe('web-v2 SubagentActivityPanel', () => {
  afterEach(cleanup);

  it('shows compact correlated child facts without raw child details', () => {
    render(
      <I18nProvider>
        <SubagentActivityPanel delegations={[{
          delegationId: 'delegation-1',
          rootRunId: 'run-root-1',
          childRunId: 'run-child-1',
          agentProfileId: 'builtin:ask',
          agentName: 'Ask',
          task: 'Inspect the durable boundary.',
          status: 'finished',
          outcome: 'done',
          summary: 'Found the shared client seam.',
          startedAt: '2026-08-27T08:00:00.000Z',
          finishedAt: '2026-08-27T08:00:03.000Z',
        }]} />
      </I18nProvider>,
    );

    expect(screen.getByLabelText('Live subagent activity')).toBeTruthy();
    expect(screen.getByText('Ask')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('3s')).toBeTruthy();
    expect(screen.getByText('Found the shared client seam.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('run-child-1');
  });
});
