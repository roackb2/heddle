import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dayjs from 'dayjs';
import compact from 'lodash/compact.js';
import { EventSource } from 'eventsource';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import type { ResolvedRuntimeHost } from '@heddleagent/runtime/cli';
import type { ConversationDelegationMode } from '@/core/chat/types.js';
import { ControlPlaneSessionApiService } from '@/cli-v2/services/sessions/control-plane-session-api-service.js';
import {
  AskJsonlProtocolWriter,
  AskJsonlRunService,
} from './ask-jsonl-run-service.js';
import { ControlPlaneCommandRuntimeService } from './control-plane-command-runtime.js';

export type AskCliV2OutputFormat = 'text' | 'jsonl';

export type AskCliV2CommandOptions = {
  workspaceRoot: string;
  activeWorkspaceId?: string;
  model?: string;
  maxSteps?: number;
  apiKey?: string;
  preferApiKey?: boolean;
  stateDir: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  runtimeHost: ResolvedRuntimeHost;
  forceOwnerConflict?: boolean;
  sessionId?: string;
  latestSession?: boolean;
  createSessionName?: string;
  agentProfileId?: string;
  delegation?: ConversationDelegationMode;
  promptFile?: string;
  output?: AskCliV2OutputFormat | string;
  stdin?: AsyncIterable<string | Uint8Array>;
};

export type AskCliV2CommandResult = {
  exitCode: number;
};

type AskSessionSelection = {
  sessionId?: string;
  latestSession?: boolean;
  createSessionName?: string;
};

/**
 * Command edge for `heddle ask`.
 *
 * Owns: terminal ask validation, control-plane attach/embed bootstrap, session
 * selection/creation policy for the ask command, API submission, and terminal
 * result formatting.
 *
 * Does not own: conversation execution, session persistence, compaction,
 * approval policy, memory maintenance, or chat runtime fallbacks. Those remain
 * behind the shared control-plane session API and its server/core owners.
 */
export class AskCliV2CommandEdgeService {
  static async run(goal: string, options: AskCliV2CommandOptions): Promise<AskCliV2CommandResult> {
    const output = AskCliV2CommandEdgeService.resolveOutputFormat(options.output);
    const jsonlWriter = output === 'jsonl' ? new AskJsonlProtocolWriter() : undefined;

    try {
      const prompt = await AskCliV2CommandEdgeService.resolvePrompt(goal, options);
      AskCliV2CommandEdgeService.assertSingleSessionSelection(options);
      return await AskCliV2CommandEdgeService.runPrompt(prompt, options, output, jsonlWriter);
    } catch (error) {
      if (!jsonlWriter) {
        throw error;
      }

      jsonlWriter.writeCommandError(error);
      return { exitCode: 1 };
    }
  }

  private static async runPrompt(
    prompt: string,
    options: AskCliV2CommandOptions,
    output: AskCliV2OutputFormat,
    jsonlWriter?: AskJsonlProtocolWriter,
  ): Promise<AskCliV2CommandResult> {
    const runtime = await ControlPlaneCommandRuntimeService.resolve({
      workspaceRoot: options.workspaceRoot,
      stateDir: options.stateDir,
      preferApiKey: Boolean(options.preferApiKey),
      runtimeHost: options.runtimeHost,
      forceOwnerConflict: Boolean(options.forceOwnerConflict),
      heartbeatScheduler: { enabled: false },
    });
    const uninstallRuntimeShutdown =
      runtime.kind === 'embedded' ? ControlPlaneCommandRuntimeService.installEmbeddedShutdown(runtime, 'ask') : () => undefined;

    try {
      const notice = `${ControlPlaneCommandRuntimeService.formatNotice(runtime, 'ask')}\n`;
      (output === 'jsonl' ? process.stderr : process.stdout).write(notice);

      const client = ClientSharedProxyApiService.createClient({
        url: runtime.trpcUrl,
        eventSource: EventSource,
      });
      const sessionApi = new ControlPlaneSessionApiService({
        client,
        defaultModel: options.model,
        maxSteps: options.maxSteps,
        searchIgnoreDirs: options.searchIgnoreDirs,
        systemContext: options.systemContext,
        apiKey: options.apiKey,
        preferApiKey: options.preferApiKey,
      });
      const workspaceId = options.activeWorkspaceId ?? await sessionApi.resolveWorkspaceId();
      const sessionId = await AskCliV2CommandEdgeService.resolveSessionId(sessionApi, workspaceId, options);
      if (output === 'jsonl') {
        if (!jsonlWriter) {
          throw new Error('The JSONL protocol writer was not initialized.');
        }

        const exitCode = await new AskJsonlRunService({
          client,
          sessionApi,
          writer: jsonlWriter,
        }).run({
          workspaceId,
          sessionId,
          prompt,
          agentProfileId: options.agentProfileId ?? 'builtin:ask',
          delegation: options.delegation,
        });
        return { exitCode };
      }

      const result = await sessionApi.sendPrompt({
        workspaceId,
        sessionId,
        prompt,
        agentProfileId: options.agentProfileId ?? 'builtin:ask',
        delegation: options.delegation,
        includePlanTool: false,
        memoryMaintenanceMode: 'inline',
      });

      AskCliV2CommandEdgeService.writeResult({
        sessionId: result.session?.id ?? sessionId,
        outcome: result.outcome,
        summary: result.summary,
        agentName: result.session?.turns.at(-1)?.agent?.name,
        traceFile: result.session?.turns.at(-1)?.traceFile,
        latestArchivePath: result.session?.context?.archive?.lastArchivePath,
      });
      return { exitCode: result.outcome === 'done' ? 0 : 1 };
    } finally {
      uninstallRuntimeShutdown();
      await runtime.close();
    }
  }

  private static resolveOutputFormat(output: string | undefined): AskCliV2OutputFormat {
    const resolved = output ?? 'text';
    if (resolved === 'text' || resolved === 'jsonl') {
      return resolved;
    }

    throw new Error('Usage: --output must be one of text or jsonl.');
  }

  private static async resolvePrompt(goal: string, options: AskCliV2CommandOptions): Promise<string> {
    const positionalPrompt = goal.trim();
    if (options.promptFile !== undefined && positionalPrompt) {
      throw new Error('Usage: pass either a positional goal or --prompt-file, not both.');
    }

    if (options.promptFile === undefined) {
      if (!positionalPrompt) {
        throw new Error('Usage: heddle ask "<goal>" or heddle ask --prompt-file <path>');
      }
      return positionalPrompt;
    }

    const prompt = options.promptFile === '-'
      ? await AskCliV2CommandEdgeService.readStdin(options.stdin ?? process.stdin)
      : await readFile(resolve(options.workspaceRoot, options.promptFile), 'utf8');
    if (!prompt.trim()) {
      throw new Error('The ask prompt cannot be empty.');
    }

    return prompt;
  }

  private static async readStdin(stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private static assertSingleSessionSelection(selection: AskSessionSelection): void {
    const selectedModes = compact([
      selection.sessionId,
      selection.latestSession ? 'latest' : undefined,
      selection.createSessionName !== undefined ? 'new-session' : undefined,
    ]);
    if (selectedModes.length > 1) {
      throw new Error('Choose only one of --session, --latest, or --new-session for heddle ask.');
    }
  }

  private static async resolveSessionId(
    sessionApi: ControlPlaneSessionApiService,
    workspaceId: string,
    selection: AskSessionSelection & Pick<AskCliV2CommandOptions, 'model'>,
  ): Promise<string> {
    if (selection.sessionId) {
      return selection.sessionId;
    }

    if (selection.latestSession) {
      const resumeSessionId = (await sessionApi.readSessions(workspaceId)).resumeSessionId;
      if (!resumeSessionId) {
        throw new Error('No saved chat sessions are available yet. Use --new-session to create one first.');
      }
      return resumeSessionId;
    }

    const created = await sessionApi.createSession(workspaceId, {
      name: AskCliV2CommandEdgeService.resolveCreatedSessionName(selection.createSessionName),
      model: selection.model,
      retention: selection.createSessionName === undefined ? 'one_off' : 'reusable',
    });
    return created.id;
  }

  private static resolveCreatedSessionName(createSessionName: string | undefined): string | undefined {
    if (createSessionName !== undefined) {
      return createSessionName.trim() || undefined;
    }

    return `Ask ${dayjs().toISOString()}`;
  }

  private static writeResult(result: {
    sessionId: string;
    outcome: string;
    summary: string;
    agentName?: string;
    traceFile?: string;
    latestArchivePath?: string;
  }): void {
    process.stdout.write(`${compact([
      `Session: ${result.sessionId}`,
      `Outcome: ${result.outcome}`,
      result.agentName ? `Agent: ${result.agentName}` : undefined,
      `Summary: ${result.summary}`,
      result.traceFile ? `Trace: ${result.traceFile}` : undefined,
      result.latestArchivePath ? `Latest archive: ${result.latestArchivePath}` : undefined,
    ]).join('\n')}\n`);
  }
}
