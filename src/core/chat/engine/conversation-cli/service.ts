import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import type { Writable } from 'node:stream';
import { createConversationEngine } from '../conversation-engine.js';
import { createConversationTextHost } from '../text-host/index.js';
import type { ChatSession } from '../../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';
import type { ConversationEngine, ConversationEngineHost } from '../types.js';
import type {
  ConversationCliLocalCommand,
  ConversationCliRunnerOptions,
  ConversationCliTurnContext,
} from './types.js';

const DEFAULT_PROMPT_LABEL = 'heddle> ';
const BUILT_IN_COMMANDS = [
  { command: '/session', description: 'print the active session id' },
  { command: '/help', description: 'print available local commands' },
  { command: '/exit', aliases: ['/quit'], description: 'close the conversation loop' },
] satisfies Array<Pick<ConversationCliLocalCommand, 'aliases' | 'command' | 'description'>>;

/**
 * Owns the minimal interactive console experience for SDK starters.
 *
 * Keep terminal lifecycle, session resume, one-shot submission, prompt
 * formatting, and local command dispatch here. Product hosts should only drop
 * down to `createConversationEngine` when they need to own a full UI or runtime
 * control path rather than a lightly customized CLI loop.
 */
export class ConversationCliRunnerService {
  static async run(options: ConversationCliRunnerOptions): Promise<void> {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const stateRoot = options.stateRoot ?? join(workspaceRoot, '.heddle');
    const output = options.output ?? stdout;
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      apiKey: options.apiKey,
      preferApiKey: options.preferApiKey,
      systemContext: options.systemContext,
      memoryMaintenanceMode: options.memoryMaintenanceMode,
      tools: options.tools,
      hostExtensions: options.hostExtensions,
    });
    let session = ConversationCliRunnerService.resolveSession({ engine, options });
    const textHost = createConversationTextHost({
      output: (text) => output.write(text),
      trace: 'status',
    });
    const host = ConversationCliRunnerService.composeHost(textHost.host, options.host);

    output.write(`Session: ${session.id}\n`);
    output.write(`Commands: ${ConversationCliRunnerService.formatCommandList(options.localCommands)}\n`);

    if (options.oncePrompt?.trim()) {
      await ConversationCliRunnerService.submitPrompt({
        engine,
        host,
        options,
        prompt: options.oncePrompt.trim(),
        session,
        stateRoot,
        textHost,
        workspaceRoot,
      });
      return;
    }

    const inputLoop = createInterface({
      input: options.input ?? stdin,
      output,
    });

    try {
      for (;;) {
        const rawPrompt = await ConversationCliRunnerService.readPrompt(inputLoop, options.promptLabel ?? DEFAULT_PROMPT_LABEL);
        if (rawPrompt === undefined) {
          break;
        }

        const prompt = rawPrompt.trim();
        if (!prompt) {
          continue;
        }

        const localCommand = ConversationCliRunnerService.resolveLocalCommand({
          command: prompt,
          localCommands: options.localCommands,
        });
        if (localCommand) {
          if (localCommand.type === 'exit') {
            break;
          }

          await ConversationCliRunnerService.handleLocalCommand({
            command: prompt,
            engine,
            localCommand,
            localCommands: options.localCommands,
            output,
            session,
            stateRoot,
            workspaceRoot,
          });
          continue;
        }

        const result = await ConversationCliRunnerService.submitPrompt({
          engine,
          host,
          options,
          prompt,
          session,
          stateRoot,
          textHost,
          workspaceRoot,
        });
        session = result.session;
      }
    } finally {
      inputLoop.close();
    }
  }

  private static async readPrompt(
    inputLoop: ReturnType<typeof createInterface>,
    promptLabel: string,
  ): Promise<string | undefined> {
    try {
      return await inputLoop.question(promptLabel);
    } catch (error) {
      if (error instanceof Error && error.message === 'readline was closed') {
        return undefined;
      }

      throw error;
    }
  }

  private static resolveSession(input: {
    engine: ConversationEngine;
    options: ConversationCliRunnerOptions;
  }): ChatSession {
    return input.options.sessionId
      ? input.engine.sessions.require(input.options.sessionId)
      : input.engine.sessions.create({
          name: input.options.sessionName ?? 'Heddle SDK interactive chat',
        });
  }

  private static async submitPrompt(input: {
    engine: ConversationEngine;
    host: ConversationEngineHost;
    options: ConversationCliRunnerOptions;
    prompt: string;
    session: ChatSession;
    stateRoot: string;
    textHost: ReturnType<typeof createConversationTextHost>;
    workspaceRoot: string;
  }): Promise<ConversationTurnResultSummary> {
    const submittedPrompt = input.options.formatPrompt?.(input.prompt) ?? input.prompt;
    const context = {
      engine: input.engine,
      prompt: input.prompt,
      session: input.session,
      stateRoot: input.stateRoot,
      submittedPrompt,
      workspaceRoot: input.workspaceRoot,
    } satisfies ConversationCliTurnContext;

    await input.options.onTurnStarted?.(context);

    const result = await input.engine.turns.submit({
      sessionId: input.session.id,
      prompt: submittedPrompt,
      maxSteps: input.options.maxSteps,
      host: input.host,
      memoryMaintenanceMode: input.options.memoryMaintenanceMode,
    });
    input.textHost.renderTurnResult(result);
    await input.options.onTurnFinished?.({
      ...context,
      result,
      session: result.session,
    });

    return result;
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

  private static async handleLocalCommand(input: {
    command: string;
    engine: ConversationEngine;
    localCommand: ResolvedLocalCommand;
    localCommands: ConversationCliLocalCommand[] | undefined;
    output: NodeJS.WritableStream;
    session: ChatSession;
    stateRoot: string;
    workspaceRoot: string;
  }): Promise<void> {
    if (input.localCommand.type === 'session') {
      input.output.write(`Session: ${input.session.id}\n`);
      return;
    }

    if (input.localCommand.type === 'help') {
      input.output.write(`Commands: ${ConversationCliRunnerService.formatCommandList(input.localCommands)}\n`);
      return;
    }

    if (input.localCommand.type !== 'custom') {
      return;
    }

    await input.localCommand.command.run({
      command: input.command,
      engine: input.engine,
      output: input.output as Writable,
      session: input.session,
      stateRoot: input.stateRoot,
      workspaceRoot: input.workspaceRoot,
    });
  }

  private static resolveLocalCommand(input: {
    command: string;
    localCommands: ConversationCliLocalCommand[] | undefined;
  }): ResolvedLocalCommand | undefined {
    const commandName = input.command.split(/\s+/)[0];
    const builtIn = ConversationCliRunnerService.resolveBuiltInCommand(commandName);
    if (builtIn) {
      return builtIn;
    }

    const customCommand = input.localCommands
      ?.find((localCommand) => [
        localCommand.command,
        ...(localCommand.aliases ?? []),
      ].includes(commandName));

    return customCommand
      ? {
          type: 'custom',
          command: customCommand,
        }
      : undefined;
  }

  private static resolveBuiltInCommand(command: string): ResolvedLocalCommand | undefined {
    if (command === '/exit' || command === '/quit') {
      return { type: 'exit' };
    }

    if (command === '/session') {
      return { type: 'session' };
    }

    if (command === '/help') {
      return { type: 'help' };
    }

    return undefined;
  }

  private static formatCommandList(localCommands: ConversationCliLocalCommand[] | undefined): string {
    return [
      ...BUILT_IN_COMMANDS.map((command) => command.command),
      ...(localCommands ?? []).map((command) => command.command),
    ].join(', ');
  }
}

type ResolvedLocalCommand =
  | { type: 'custom'; command: ConversationCliLocalCommand }
  | { type: 'exit' }
  | { type: 'help' }
  | { type: 'session' };

export const runConversationCli = ConversationCliRunnerService.run;
