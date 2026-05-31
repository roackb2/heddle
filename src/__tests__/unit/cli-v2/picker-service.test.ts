import { describe, expect, it } from 'vitest';
import type { ControlPlaneModelOptions, ControlPlaneSessionView } from '../../../client-shared/api/types.js';
import { CliV2PickerService } from '../../../cli-v2/services/pickers/index.js';

describe('CliV2PickerService', () => {
  it('filters cached model options for the /model set picker', () => {
    const modelOptions: ControlPlaneModelOptions = {
      groups: [
        {
          label: 'OpenAI',
          models: ['gpt-5.4', 'gpt-5.4-mini'],
          options: [
            { id: 'gpt-5.4', disabled: false },
            { id: 'gpt-5.4-mini', disabled: false },
          ],
        },
      ],
    };

    const query = CliV2PickerService.modelQuery('/model set mini');

    expect(query).toBe('mini');
    expect(CliV2PickerService.filterModels(modelOptions, query)).toEqual([
      { id: 'gpt-5.4-mini', disabled: false },
    ]);
  });

  it('filters cached sessions for the /session choose picker', () => {
    const sessions: ControlPlaneSessionView[] = [
      { id: 'session-1', name: 'Planning', messageCount: 0, turnCount: 0 },
      { id: 'session-2', name: 'Implementation', messageCount: 0, turnCount: 0 },
    ];

    const query = CliV2PickerService.sessionQuery('/session choose impl');

    expect(query).toBe('impl');
    expect(CliV2PickerService.filterSessions(sessions, query)).toEqual([
      { id: 'session-2', name: 'Implementation' },
    ]);
  });

  it('cycles picker indexes locally', () => {
    expect(CliV2PickerService.nextIndex(1, 2)).toBe(0);
    expect(CliV2PickerService.previousIndex(0, 2)).toBe(1);
    expect(CliV2PickerService.clampIndex(4, 2)).toBe(1);
  });
});
