import dayjs from 'dayjs';
import compact from 'lodash/compact.js';
import { ClientSharedProxyApiService } from '@/client-shared/api/proxy.js';
import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import { ControlPlaneSessionApiService } from '@/cli-v2/services/sessions/control-plane-session-api-service.js';
import { ControlPlaneCommandRuntimeService } from './control-plane-command-runtime.js';

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
  static async run(goal: string, options: AskCliV2CommandOptions): Promise<void> {
    const prompt = goal.trim();
    if (!prompt) {
      throw new Error('Usage: heddle ask "<goal>"');
    }

    AskCliV2CommandEdgeService.assertSingleSessionSelection(options);

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
      process.stdout.write(`${ControlPlaneCommandRuntimeService.formatNotice(runtime, 'ask')}\n`);

      const sessionApi = new ControlPlaneSessionApiService({
        client: ClientSharedProxyApiService.createClient({ url: runtime.trpcUrl }),
        defaultModel: options.model,
        maxSteps: options.maxSteps,
        searchIgnoreDirs: options.searchIgnoreDirs,
        systemContext: options.systemContext,
        apiKey: options.apiKey,
        preferApiKey: options.preferApiKey,
      });
      const workspaceId = options.activeWorkspaceId ?? await sessionApi.resolveWorkspaceId();
      const sessionId = await AskCliV2CommandEdgeService.resolveSessionId(sessionApi, workspaceId, options);
      const result = await sessionApi.sendPrompt({
        workspaceId,
        sessionId,
        prompt,
        agentProfileId: options.agentProfileId ?? 'builtin:ask',
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
    } finally {
      uninstallRuntimeShutdown();
      await runtime.close();
    }
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
      const latest = (await sessionApi.listSessions(workspaceId))[0];
      if (!latest) {
        throw new Error('No saved chat sessions are available yet. Use --new-session to create one first.');
      }
      return latest.id;
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
