export type BrowserAutomationIntent = 'preferred';

export type BrowserAutomationIntentContextInput = {
  intent?: BrowserAutomationIntent;
  systemContext?: string;
};

const BROWSER_AUTOMATION_INTENT_CONTEXT = [
  'Browser automation was explicitly requested for this user message.',
  'If browser tools are available and useful for the task, prefer opening the user-relevant page in the configured browser instead of relying only on web search or guessing URLs.',
  'Use the URL, page, product, app, or workflow named by the user or discovered from the task context; do not navigate to placeholder or diagnostic pages unless the user asks for a diagnostic.',
  'Keep normal browser policy authoritative: avoid forbidden actions, request approval when required, and summarize browser evidence such as page title, visible text, links, and screenshots when it helps the user evaluate the result.',
].join('\n');

/**
 * Owns the model-facing instruction generated from a per-message browser nudge.
 *
 * UI surfaces only send a small intent flag. They must not duplicate this text
 * or choose browser URLs; the agent and browser tools resolve task-specific
 * navigation from the user request under browser policy.
 */
export class BrowserAutomationIntentContextService {
  static append(input: BrowserAutomationIntentContextInput): string | undefined {
    if (input.intent !== 'preferred') {
      return input.systemContext;
    }

    return [input.systemContext, BROWSER_AUTOMATION_INTENT_CONTEXT]
      .filter((part): part is string => Boolean(part?.trim()))
      .join('\n\n');
  }
}
