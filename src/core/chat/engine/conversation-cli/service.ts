import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createConversationEngine } from '../conversation-engine.js';
import { createConversationTextHost } from '../text-host/index.js';
import type { ConversationEngineHost } from '../types.js';
import type { ConversationCliRunnerOptions } from './types.js';

const DEFAULT_PROMPT_LABEL = 'heddle> ';
const LOCAL_COMMANDS = new Set(['/exit', '/quit', '/help', '/session']);

/**
 * Owns the minimal interactive console experience for SDK starters.
 *
 * This is intentionally small: it wires a persisted conversation session,
 * default text rendering, and a readline loop. Product hosts should graduate to
 * `createConversationEngine` directly when they need custom UI, routing,
 * approvals, or product-specific commands.
 */
export class ConversationCliRunnerService {
  static async run(options: ConversationCliRunnerOptions): Promise<void> {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const stateRoot = options.stateRoot ?? join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      apiKey: options.apiKey,
      preferApiKey: options.preferApiKey,
      systemContext: options.systemContext,
      tools: options.tools,
      hostExtensions: options.hostExtensions,
    });
    const session = engine.sessions.create({
      name: options.sessionName ?? 'Heddle SDK interactive chat',
    });
    const textHost = createConversationTextHost({
      output: (text) => (options.output ?? stdout).write(text),
      trace: 'status',
    });
    const host = ConversationCliRunnerService.composeHost(textHost.host, options.host);
    const inputLoop = createInterface({
      input: options.input ?? stdin,
      output: options.output ?? stdout,
    });

    (options.output ?? stdout).write(`Session: ${session.id}\n`);
    (options.output ?? stdout).write('Commands: /session, /help, /exit\n');

    try {
      for (;;) {
        const prompt = (await inputLoop.question(options.promptLabel ?? DEFAULT_PROMPT_LABEL)).trim();
        if (!prompt) {
          continue;
        }

        if (LOCAL_COMMANDS.has(prompt)) {
          if (prompt === '/exit' || prompt === '/quit') {
            break;
          }

          ConversationCliRunnerService.handleLocalCommand({
            output: options.output ?? stdout,
            prompt,
            sessionId: session.id,
          });
          continue;
        }

        const result = await engine.turns.submit({
          sessionId: session.id,
          prompt,
          maxSteps: options.maxSteps,
          host,
        });
        textHost.renderTurnResult(result);
      }
    } finally {
      inputLoop.close();
    }
  }

  private static composeHost(
    textHost: ConversationEngineHost,
    customHost: ConversationEngineHost | undefined,
  ): ConversationEngineHost {
    return {
      ...textHost,
      ...customHost,
      events: {
        onActivity(activity) {
          textHost.events?.onActivity?.(activity);
          customHost?.events?.onActivity?.(activity);
        },
      },
      trace: {
        onEvent(event) {
          textHost.trace?.onEvent?.(event);
          customHost?.trace?.onEvent?.(event);
        },
      },
      compaction: {
        onStatus(event) {
          textHost.compaction?.onStatus?.(event);
          customHost?.compaction?.onStatus?.(event);
        },
      },
    };
  }

  private static handleLocalCommand(input: {
    output: NodeJS.WritableStream;
    prompt: string;
    sessionId: string;
  }): void {
    if (input.prompt === '/session') {
      input.output.write(`Session: ${input.sessionId}\n`);
      return;
    }

    input.output.write('Commands: /session, /help, /exit\n');
  }
}

export const runConversationCli = ConversationCliRunnerService.run;
