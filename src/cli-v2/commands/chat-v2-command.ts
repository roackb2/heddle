import type { ResolvedRuntimeHost } from '@/core/runtime/daemon/index.js';
import { startChatCliV2 } from '../index.js';
import { ControlPlaneCommandRuntimeService } from './control-plane-command-runtime.js';

export type ChatCliV2CommandOptions = {
  workspaceRoot: string;
  activeWorkspaceId: string;
  model?: string;
  maxSteps?: number;
  preferApiKey: boolean;
  stateDir: string;
  searchIgnoreDirs: string[];
  systemContext?: string;
  runtimeHost: ResolvedRuntimeHost;
  forceOwnerConflict: boolean;
};

/**
 * Command edge for `heddle chat` / `heddle chat-v2`.
 *
 * Owns: terminal command bootstrap, attach-or-embed control-plane transport,
 * startup notice output, and TUI process lifetime.
 *
 * Does not own: chat session behavior, workspace-scoped request semantics,
 * approval policy, or conversation execution. The Ink client consumes the
 * shared control-plane API after this edge creates the transport.
 */
export class ChatCliV2CommandEdgeService {
  static async run(options: ChatCliV2CommandOptions): Promise<void> {
    const runtime = await ControlPlaneCommandRuntimeService.resolve(options);
    process.stdout.write(`${ControlPlaneCommandRuntimeService.formatNotice(runtime, 'chat-v2')}\n`);
    const uninstallRuntimeShutdown =
      runtime.kind === 'embedded' ? ControlPlaneCommandRuntimeService.installEmbeddedShutdown(runtime, 'chat-v2') : () => undefined;
    const app = startChatCliV2({
      trpcUrl: runtime.trpcUrl,
      workspaceId: options.activeWorkspaceId,
      model: options.model,
      maxSteps: options.maxSteps,
      searchIgnoreDirs: options.searchIgnoreDirs,
      systemContext: options.systemContext,
      preferApiKey: options.preferApiKey,
    });
    try {
      await app.waitUntilExit();
    } finally {
      uninstallRuntimeShutdown();
      await runtime.close();
    }
  }
}
