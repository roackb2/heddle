/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ControlPlaneModelOptions } from '@/client-shared/api/types.js';
import { ComposerExecutionMenu } from '../../../web-v2/components/conversation/ComposerExecutionMenu.js';
import { I18nProvider } from '../../../web-v2/i18n/I18nProvider.js';

describe('web-v2 ComposerExecutionMenu', () => {
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

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Ollama · Installed local models')).toBeTruthy();
    expect(screen.getByText('llama3.2:latest')).toBeTruthy();
  });
});
