import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import type { Writable } from 'node:stream';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import type { ReasoningEffort } from '@/core/llm/types.js';
import {
  RuntimeCredentialService,
} from '@/core/runtime/credentials/index.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';
import { createConversationEngine } from '../conversation-engine.js';
import { createConversationTextHost } from '../text-host/index.js';
import type { ChatSession } from '../../types.js';
import type { ConversationTurnResultSummary } from '../turn-result.js';
import type { ConversationEngine, ConversationEngineHost } from '../types.js';
import type {
  QuickstartConversationCliCredentialContext,
  QuickstartConversationCliCredentialPreflightOptions,
  QuickstartConversationCliLocalCommand,
  QuickstartConversationCliRunnerDefaults,
  QuickstartConversationCliRunnerDefaultsInput,
  QuickstartConversationCliRunnerOptions,
  QuickstartConversationCliTurnContext,
} from './types.js';

const DEFAULT_PROMPT_LABEL = 'heddle> ';
const DEFAULT_MEMORY_MAINTENANCE_MODE = 'none';
const SUPPORTED_REASONING_EFFORTS = new Set<ReasoningEffort>(['low', 'medium', 'high', 'ultrahigh']);
const BUILT_IN_COMMANDS = [
  { command: '/session', description: 'print the active session id' },
  { command: '/help', description: 'print available local commands' },
  { command: '/exit', aliases: ['/quit'], description: 'close the conversation loop' },
] satisfies Array<Pick<QuickstartConversationCliLocalCommand, 'aliases' | 'command' | 'description'>>;

/**
 * Owns the minimal quickstart console experience for SDK starters.
 *
 * Keep terminal lifecycle, session resume, one-shot submission, prompt
 * formatting, and local command dispatch here only when they make first-run
 * SDK examples smaller. Heddle product CLI/TUI behavior belongs in `src/cli-v2`;
 * product-specific host behavior belongs in that product host.
 */
export class QuickstartConversationCliRunnerService {
  static async run(options: QuickstartConversationCliRunnerOptions = {}): Promise<void> {
    const defaults = QuickstartConversationCliRunnerService.resolveDefaults(options);
    const { stateRoot, workspaceRoot } = defaults;
    const output = options.output ?? stdout;
    const credentialContext = QuickstartConversationCliRunnerService.preflightCredentials({
      defaults,
      options,
    });
    const engine = createConversationEngine({
      workspaceRoot,
      stateRoot,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
      apiKey: options.apiKey,
      preferApiKey: options.preferApiKey,
      credentialStorePath: options.credentialStorePath,
      systemContext: options.systemContext,
      memoryMaintenanceMode: defaults.memoryMaintenanceMode,
      tools: options.tools,
      hostExtensions: options.hostExtensions,
      artifactRepository: options.artifactRepository,
      sessionRepository: options.sessionRepository,
      archiveRepository: options.archiveRepository,
    });
    let session = await QuickstartConversationCliRunnerService.resolveSession({ engine, options });
    const textHost = createConversationTextHost({
      output: (text) => output.write(text),
      trace: 'status',
    });
    const host = QuickstartConversationCliRunnerService.composeHost(textHost.host, options.host);

    QuickstartConversationCliRunnerService.writeRuntimeStatus({
      credentialContext,
      defaults,
      output,
    });
    output.write(`Session: ${session.id}\n`);
    output.write(`Commands: ${QuickstartConversationCliRunnerService.formatCommandList(options.localCommands)}\n`);

    if (options.oncePrompt?.trim()) {
      await QuickstartConversationCliRunnerService.submitPrompt({
        defaults,
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

    // Scripted multi-turn: run an explicit ordered list of prompts/commands
    // without a readline loop. This is the reproducible non-interactive path
    // (piping several lines into an interactive loop drops queued prompts once
    // stdin closes mid-turn).
    if (options.prompts && options.prompts.length > 0) {
      const promptLabel = options.promptLabel ?? DEFAULT_PROMPT_LABEL;
      for (const scriptedPrompt of options.prompts) {
        output.write(`${promptLabel}${scriptedPrompt}\n`);
        const outcome = await QuickstartConversationCliRunnerService.dispatchPrompt({
          defaults,
          engine,
          host,
          options,
          output,
          rawPrompt: scriptedPrompt,
          session,
          stateRoot,
          textHost,
          workspaceRoot,
        });
        session = outcome.session;
        if (outcome.stop) {
          break;
        }
      }
      return;
    }

    const inputLoop = createInterface({
      input: options.input ?? stdin,
      output,
    });

    try {
      for (;;) {
        const rawPrompt = await QuickstartConversationCliRunnerService.readPrompt(inputLoop, options.promptLabel ?? DEFAULT_PROMPT_LABEL);
        if (rawPrompt === undefined) {
          break;
        }

        const outcome = await QuickstartConversationCliRunnerService.dispatchPrompt({
          defaults,
          engine,
          host,
          options,
          output,
          rawPrompt,
          session,
          stateRoot,
          textHost,
          workspaceRoot,
        });
        session = outcome.session;
        if (outcome.stop) {
          break;
        }
      }
    } finally {
      inputLoop.close();
    }
  }

  /**
   * Runs one raw input line as either a local command or a model turn. Shared
   * by the interactive loop and the scripted multi-turn path so both dispatch
   * prompts, commands, and `/exit` handling identically.
   */
  private static async dispatchPrompt(input: {
    defaults: QuickstartConversationCliRunnerDefaults;
    engine: ConversationEngine;
    host: ConversationEngineHost;
    options: QuickstartConversationCliRunnerOptions;
    output: NodeJS.WritableStream;
    rawPrompt: string;
    session: ChatSession;
    stateRoot: string;
    textHost: ReturnType<typeof createConversationTextHost>;
    workspaceRoot: string;
  }): Promise<{ session: ChatSession; stop: boolean }> {
    const prompt = input.rawPrompt.trim();
    if (!prompt) {
      return { session: input.session, stop: false };
    }

    const localCommand = QuickstartConversationCliRunnerService.resolveLocalCommand({
      command: prompt,
      localCommands: input.options.localCommands,
    });
    if (localCommand) {
      if (localCommand.type === 'exit') {
        return { session: input.session, stop: true };
      }

      await QuickstartConversationCliRunnerService.handleLocalCommand({
        command: prompt,
        engine: input.engine,
        localCommand,
        localCommands: input.options.localCommands,
        output: input.output,
        session: input.session,
        stateRoot: input.stateRoot,
        workspaceRoot: input.workspaceRoot,
      });
      return { session: input.session, stop: false };
    }

    const result = await QuickstartConversationCliRunnerService.submitPrompt({
      defaults: input.defaults,
      engine: input.engine,
      host: input.host,
      options: input.options,
      prompt,
      session: input.session,
      stateRoot: input.stateRoot,
      textHost: input.textHost,
      workspaceRoot: input.workspaceRoot,
    });
    return { session: result.session, stop: false };
  }

  static resolveDefaults(options: QuickstartConversationCliRunnerDefaultsInput = {}): QuickstartConversationCliRunnerDefaults {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();

    return {
      ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
      memoryMaintenanceMode: options.memoryMaintenanceMode ?? DEFAULT_MEMORY_MAINTENANCE_MODE,
      model: QuickstartConversationCliRunnerService.resolveModel(options),
      reasoningEffort: QuickstartConversationCliRunnerService.resolveReasoningEffort(options.reasoningEffort),
      stateRoot: options.stateRoot ?? join(workspaceRoot, '.heddle'),
      workspaceRoot,
    };
  }

  private static preflightCredentials(input: {
    defaults: QuickstartConversationCliRunnerDefaults;
    options: QuickstartConversationCliRunnerOptions;
  }): QuickstartConversationCliCredentialContext | undefined {
    const preflight = QuickstartConversationCliRunnerService.resolveCredentialPreflight(input.options.credentialPreflight);
    if (!preflight.enabled) {
      return undefined;
    }

    const resolution = LlmProviderRuntimeService.resolve({
      apiKey: input.options.apiKey,
      credentialStorePath: input.options.credentialStorePath,
      model: input.defaults.model,
      preferApiKey: input.options.preferApiKey,
      reasoningEffort: input.defaults.reasoningEffort,
    });
    const context = {
      model: resolution.model,
      preferApiKey: input.options.preferApiKey,
      provider: resolution.provider,
      source: resolution.credentialSource,
    } satisfies QuickstartConversationCliCredentialContext;

    if (resolution.credentialSource.type === 'missing') {
      throw new Error([
        RuntimeCredentialService.formatMissingCredentialMessage(resolution.model),
        QuickstartConversationCliRunnerService.resolveMissingCredentialHint({
          context,
          missingCredentialHint: preflight.missingCredentialHint,
        }),
      ].filter(Boolean).join(' '));
    }

    return preflight.status === 'status' ? context : undefined;
  }

  private static resolveCredentialPreflight(
    input: QuickstartConversationCliRunnerOptions['credentialPreflight'],
  ): Required<Pick<QuickstartConversationCliCredentialPreflightOptions, 'enabled' | 'status'>>
    & Pick<QuickstartConversationCliCredentialPreflightOptions, 'missingCredentialHint'> {
    if (input === false) {
      return {
        enabled: false,
        status: 'off',
      };
    }

    if (input === true || input === undefined) {
      return {
        enabled: true,
        status: 'status',
      };
    }

    return {
      enabled: input.enabled ?? true,
      missingCredentialHint: input.missingCredentialHint,
      status: input.status ?? 'status',
    };
  }

  private static resolveMissingCredentialHint(input: {
    context: QuickstartConversationCliCredentialContext;
    missingCredentialHint: QuickstartConversationCliCredentialPreflightOptions['missingCredentialHint'];
  }): string | undefined {
    const hint = typeof input.missingCredentialHint === 'function'
      ? input.missingCredentialHint(input.context)
      : input.missingCredentialHint;

    return hint?.trim() || undefined;
  }

  private static writeRuntimeStatus(input: {
    credentialContext: QuickstartConversationCliCredentialContext | undefined;
    defaults: QuickstartConversationCliRunnerDefaults;
    output: NodeJS.WritableStream;
  }): void {
    if (!input.credentialContext) {
      return;
    }

    input.output.write(`Model: ${input.credentialContext.model} (${input.credentialContext.provider})\n`);
    if (input.defaults.reasoningEffort) {
      input.output.write(`Reasoning: ${input.defaults.reasoningEffort}\n`);
    }
    input.output.write([
      `Credential: ${RuntimeCredentialService.formatCredentialSource(input.credentialContext.source)}`,
      input.credentialContext.preferApiKey ? ' (API-key preferred)' : '',
      '\n',
    ].join(''));
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

  private static async resolveSession(input: {
    engine: ConversationEngine;
    options: QuickstartConversationCliRunnerOptions;
  }): Promise<ChatSession> {
    return input.options.sessionId
      ? await input.engine.sessions.require(input.options.sessionId)
      : await input.engine.sessions.create({
          name: input.options.sessionName ?? 'Heddle SDK interactive chat',
        });
  }

  private static async submitPrompt(input: {
    defaults: QuickstartConversationCliRunnerDefaults;
    engine: ConversationEngine;
    host: ConversationEngineHost;
    options: QuickstartConversationCliRunnerOptions;
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
    } satisfies QuickstartConversationCliTurnContext;

    await input.options.onTurnStarted?.(context);

    const result = await input.engine.turns.submit({
      sessionId: input.session.id,
      prompt: submittedPrompt,
      maxSteps: input.defaults.maxSteps,
      host: input.host,
      memoryMaintenanceMode: input.defaults.memoryMaintenanceMode,
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
    localCommands: QuickstartConversationCliLocalCommand[] | undefined;
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
      input.output.write(`Commands: ${QuickstartConversationCliRunnerService.formatCommandList(input.localCommands)}\n`);
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
    localCommands: QuickstartConversationCliLocalCommand[] | undefined;
  }): ResolvedLocalCommand | undefined {
    const commandName = input.command.split(/\s+/)[0];
    const builtIn = QuickstartConversationCliRunnerService.resolveBuiltInCommand(commandName);
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

  private static formatCommandList(localCommands: QuickstartConversationCliLocalCommand[] | undefined): string {
    return [
      ...BUILT_IN_COMMANDS.map((command) => command.command),
      ...(localCommands ?? []).map((command) => command.command),
    ].join(', ');
  }

  private static resolveModel(options: QuickstartConversationCliRunnerDefaultsInput): string {
    const env = options.env ?? process.env;
    return [
      options.model,
      env.HEDDLE_MODEL,
      env.HEDDLE_EXAMPLE_MODEL,
      env.OPENAI_MODEL,
      env.ANTHROPIC_MODEL,
      DEFAULT_OPENAI_MODEL,
    ].map((candidate) => candidate?.trim())
      .find((candidate): candidate is string => Boolean(candidate)) ?? DEFAULT_OPENAI_MODEL;
  }

  private static resolveReasoningEffort(input: QuickstartConversationCliRunnerDefaultsInput['reasoningEffort']): ReasoningEffort | undefined {
    const value = input?.trim();
    if (!value) {
      return undefined;
    }

    if (SUPPORTED_REASONING_EFFORTS.has(value as ReasoningEffort)) {
      return value as ReasoningEffort;
    }

    throw new Error(`Unsupported reasoning effort: ${value}. Use one of low, medium, high, ultrahigh.`);
  }
}

type ResolvedLocalCommand =
  | { type: 'custom'; command: QuickstartConversationCliLocalCommand }
  | { type: 'exit' }
  | { type: 'help' }
  | { type: 'session' };

export const runQuickstartConversationCli = QuickstartConversationCliRunnerService.run;
export const resolveQuickstartConversationCliDefaults = QuickstartConversationCliRunnerService.resolveDefaults;
