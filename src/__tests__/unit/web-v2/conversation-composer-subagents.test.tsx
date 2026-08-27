/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCProxyClient, httpLink } from '@trpc/client';
import type { AppRouter } from '@heddleagent/runtime/cli';
import { ConversationComposer } from '@/web-v2/components/conversation/ConversationComposer.js';
import { I18nProvider } from '@/web-v2/i18n/I18nProvider.js';
import { trpcReact } from '@/web-v2/api/client.js';

describe('web-v2 ConversationComposer subagent preference', () => {
  afterEach(cleanup);

  it('defaults on and submits an explicit off override after the user flips the switch', async () => {
    const onSubmitPrompt = vi.fn().mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const trpcClient = createTRPCProxyClient<AppRouter>({
      links: [httpLink({ url: 'http://127.0.0.1:1/trpc' })],
    });
    render(
      <QueryClientProvider client={queryClient}>
        <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
          <MemoryRouter>
            <I18nProvider>
              <ConversationComposer
                sessionId="session-1"
                workspaceId="workspace-1"
                onSubmitPrompt={onSubmitPrompt}
              />
            </I18nProvider>
          </MemoryRouter>
        </trpcReact.Provider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Add context/i }));
    const subagentSwitch = screen.getByRole('switch', { name: /Subagents/i });
    expect(subagentSwitch.getAttribute('data-state')).toBe('checked');
    fireEvent.click(subagentSwitch);
    expect(subagentSwitch.getAttribute('data-state')).toBe('unchecked');

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Inspect this feature' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onSubmitPrompt).toHaveBeenCalledWith('Inspect this feature', expect.objectContaining({
        delegation: 'off',
      }));
    });
  });
});
