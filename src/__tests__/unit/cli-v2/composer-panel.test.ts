import { describe, expect, it } from 'vitest';
import { shouldDisablePromptInputSubmit } from '@/cli-v2/components/ComposerPanel.js';

describe('cli-v2 ComposerPanel', () => {
  it('keeps Enter enabled for local picker selection while normal prompt submit is disabled', () => {
    expect(shouldDisablePromptInputSubmit({
      keyboardDisabled: false,
      pickerVisible: true,
      submitDisabled: true,
    })).toBe(false);
  });

  it('still disables Enter for normal prompts and review-mode keyboard locks', () => {
    expect(shouldDisablePromptInputSubmit({
      keyboardDisabled: false,
      pickerVisible: false,
      submitDisabled: true,
    })).toBe(true);
    expect(shouldDisablePromptInputSubmit({
      keyboardDisabled: true,
      pickerVisible: true,
      submitDisabled: false,
    })).toBe(true);
  });
});
