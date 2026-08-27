import {
  DelegationPolicyService,
  type DelegationPolicy,
} from '@/core/delegation/index.js';
import type {
  ConversationDelegationConfig,
  ConversationDelegationMode,
} from './types.js';

/**
 * Owns conversation-level delegation activation. The engine policy is the
 * authority ceiling; a turn may remove delegation but never widen it.
 */
export class ConversationDelegationPolicyService {
  static resolveEnginePolicy(
    config: ConversationDelegationConfig | undefined,
  ): DelegationPolicy {
    const { mode = 'auto', ...policyInput } = config ?? {};
    ConversationDelegationPolicyService.assertMode(mode);
    return DelegationPolicyService.resolve({
      ...policyInput,
      enabled: mode === 'auto',
    });
  }

  static isEnabled(input: {
    enginePolicy: DelegationPolicy;
    turnMode?: ConversationDelegationMode;
  }): boolean {
    ConversationDelegationPolicyService.assertMode(input.turnMode);
    return input.enginePolicy.enabled && input.turnMode !== 'off';
  }

  static assertTurnMode(mode: ConversationDelegationMode | undefined): void {
    ConversationDelegationPolicyService.assertMode(mode);
  }

  private static assertMode(mode: ConversationDelegationMode | undefined): void {
    if (mode !== undefined && mode !== 'auto' && mode !== 'off') {
      throw new TypeError('conversation delegation mode must be auto or off');
    }
  }
}
