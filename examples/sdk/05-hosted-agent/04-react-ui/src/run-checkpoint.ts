import { z } from 'zod';
import type { HostedAgentBrowserStorage } from './browser-storage.js';

export const HostedAgentActivityViewSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().optional(),
  tone: z.enum(['info', 'running', 'success']),
});

const HostedAgentRunCheckpointSchema = z.object({
  runId: z.string().min(1),
  afterSequence: z.number().int().nonnegative().safe(),
  assistantText: z.string(),
  activities: z.array(HostedAgentActivityViewSchema),
});

export type HostedAgentActivityView = z.infer<typeof HostedAgentActivityViewSchema>;
export type HostedAgentRunCheckpoint = z.infer<typeof HostedAgentRunCheckpointSchema>;

export type HostedAgentRunCheckpointRead = {
  checkpoint?: HostedAgentRunCheckpoint;
  storageAvailable: boolean;
};

export function readHostedAgentRunCheckpoint(
  storage: HostedAgentBrowserStorage | undefined,
  sessionId: string,
): HostedAgentRunCheckpointRead {
  if (!storage) {
    return { storageAvailable: false };
  }
  try {
    const serialized = storage.getItem(checkpointKey(sessionId));
    if (!serialized) {
      return { storageAvailable: true };
    }
    const parsed = HostedAgentRunCheckpointSchema.safeParse(JSON.parse(serialized));
    if (parsed.success) {
      return { checkpoint: parsed.data, storageAvailable: true };
    }
    storage.removeItem(checkpointKey(sessionId));
    return { storageAvailable: true };
  } catch {
    return { storageAvailable: false };
  }
}

export function writeHostedAgentRunCheckpoint(
  storage: HostedAgentBrowserStorage | undefined,
  sessionId: string,
  checkpoint: HostedAgentRunCheckpoint,
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(
      checkpointKey(sessionId),
      JSON.stringify(HostedAgentRunCheckpointSchema.parse(checkpoint)),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearHostedAgentRunCheckpoint(
  storage: HostedAgentBrowserStorage | undefined,
  sessionId: string,
): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(checkpointKey(sessionId));
    return true;
  } catch {
    return false;
  }
}

function checkpointKey(sessionId: string): string {
  return `heddle:hosted-react-example:run:${sessionId}`;
}
