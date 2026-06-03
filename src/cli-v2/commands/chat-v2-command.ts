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

export async function runChatCliV2Command(options: ChatCliV2CommandOptions): Promise<void> {
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
