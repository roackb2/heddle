/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlPlaneModelOptions } from '@/client-shared/api/types.js';
import { ComposerExecutionMenu } from '../../../web-v2/components/conversation/ComposerExecutionMenu.js';
import { I18nProvider } from '../../../web-v2/i18n/I18nProvider.js';

describe('web-v2 ComposerExecutionMenu', () => {
  afterEach(cleanup);

  it('renders discovered Ollama models from shared model options', () => {
    const modelOptions: ControlPlaneModelOptions = {
      groups: [
        {
          label: 'Ollama · Installed local models',
          models: ['ollama/llama3.2:latest'],
          source: 'local-discovered',
          options: [
            { id: 'ollama/llama3.2:latest', label: 'llama3.2:latest', disabled: false },
          ],
        },
      ],
    };

    render(
      <I18nProvider>
        <ComposerExecutionMenu
          model="gpt-5.4"
          modelOptions={modelOptions}
          reasoningEffort="medium"
          onUpdateModel={vi.fn()}
          onUpdateReasoningEffort={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /gpt-5.4/i }));

    expect(screen.getByText('Ollama · Installed local models')).toBeTruthy();
    expect(screen.getByText('llama3.2:latest')).toBeTruthy();
  });

  it('renders model-owned GPT-5.6 reasoning levels and disabled states', () => {
    render(
      <I18nProvider>
        <ComposerExecutionMenu
          model="gpt-5.6-sol"
          reasoningEffort="medium"
          reasoningOptions={[
            { id: 'default', label: 'default', description: 'Use model default', disabled: false },
            { id: 'none', label: 'none', description: 'Set explicit none effort', disabled: false },
            { id: 'medium', label: 'medium', description: 'Set explicit medium effort', disabled: false },
            { id: 'max', label: 'max', description: 'Set explicit max effort', disabled: true, disabledReason: 'Unavailable' },
          ]}
          onUpdateReasoningEffort={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /gpt-5.6-sol/i }));

    expect((screen.getByRole('menuitemradio', { name: 'None' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitemradio', { name: /Max/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
