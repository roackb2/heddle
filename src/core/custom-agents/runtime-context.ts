import type { CustomAgentExecutionSnapshot } from './types.js';

/**
 * Owns model-facing prompt composition for a selected custom-agent snapshot.
 */
export class CustomAgentRuntimeContextService {
  /**
   * Appends agent-specific instructions after the default system context.
   */
  static appendAgentInstructions(input: {
    systemContext?: string;
    snapshot?: CustomAgentExecutionSnapshot;
  }): string | undefined {
    if (!input.snapshot || !input.snapshot.systemContextAppendix.trim()) {
      return input.systemContext;
    }

    return [
      input.systemContext,
      CustomAgentRuntimeContextService.formatAgentSection(input.snapshot),
    ].filter(Boolean).join('\n\n');
  }

  private static formatAgentSection(snapshot: CustomAgentExecutionSnapshot): string {
    return [
      '## Selected Agent Profile',
      '',
      `Name: ${snapshot.agentName}`,
      `Mode: ${snapshot.modeAlias ?? 'custom'}`,
      '',
      '## Agent Instructions',
      '',
      snapshot.systemContextAppendix,
    ].join('\n');
  }
}
