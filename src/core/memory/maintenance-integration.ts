import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { LlmAdapter } from '../llm/types.js';
import type { TraceEvent } from '../types.js';
import {
  readPendingKnowledgeCandidates,
  runKnowledgeMaintenance,
  type RunKnowledgeMaintenanceResult,
} from './maintainer.js';

const DEFAULT_LOCK_STALE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_POLL_MS = 250;
const DEFAULT_LOCK_TIMEOUT_MS = 30 * 1000;
const maintenanceQueues = new Map<string, Promise<void>>();

export type RunMaintenanceForRecordedCandidatesOptions = {
  memoryRoot: string;
  llm: LlmAdapter;
  source: string;
  trace: TraceEvent[];
  maxSteps?: number;
  lockTimeoutMs?: number;
  lockStaleAfterMs?: number;
  onTraceEvent?: (event: TraceEvent) => void;
};

export type RunMaintenanceForRecordedCandidatesResult = {
  candidateIds: string[];
  maintenance?: RunKnowledgeMaintenanceResult;
  events: TraceEvent[];
};

export async function runMaintenanceForRecordedCandidates(
  options: RunMaintenanceForRecordedCandidatesOptions,
): Promise<RunMaintenanceForRecordedCandidatesResult> {
  return await enqueueMaintenance(options.memoryRoot, () => runMaintenanceForRecordedCandidatesNow(options));
}

async function runMaintenanceForRecordedCandidatesNow(
  options: RunMaintenanceForRecordedCandidatesOptions,
): Promise<RunMaintenanceForRecordedCandidatesResult> {
  const candidateIds = [...new Set(options.trace
    .filter((event): event is Extract<TraceEvent, { type: 'memory.candidate_recorded' }> => event.type === 'memory.candidate_recorded')
    .map((event) => event.candidateId))];

  if (candidateIds.length === 0) {
    return { candidateIds, events: [] };
  }

  const pending = await readPendingKnowledgeCandidates({ memoryRoot: options.memoryRoot });
  const observations = pending.filter((candidate) => candidateIds.includes(candidate.id));
  if (observations.length === 0) {
    return { candidateIds, events: [] };
  }

  const runId = `memory-run-${Date.now()}`;
  const started = createEvent({
    type: 'memory.maintenance_started',
    runId,
    candidateIds: observations.map((candidate) => candidate.id),
    step: nextMemoryStep(options.trace),
  });
  options.onTraceEvent?.(started);

  let lock: { release: () => Promise<void> } | undefined;
  try {
    lock = await acquireMemoryMaintenanceLock({
      memoryRoot: options.memoryRoot,
      staleAfterMs: options.lockStaleAfterMs,
      timeoutMs: options.lockTimeoutMs,
    });
    const maintenance = await runKnowledgeMaintenance({
      memoryRoot: options.memoryRoot,
      observations,
      llm: options.llm,
      source: options.source,
      maxSteps: options.maxSteps,
      nextRunId: () => runId,
    });
    if (maintenance.run.outcome === 'error' || maintenance.run.outcome === 'max_steps' || maintenance.run.outcome === 'interrupted') {
      const failed = createEvent({
        type: 'memory.maintenance_failed',
        runId: maintenance.run.id,
        error: maintenance.run.summary,
        candidateIds: observations.map((candidate) => candidate.id),
        step: nextMemoryStep(options.trace),
      });
      options.onTraceEvent?.(failed);
      return { candidateIds, maintenance, events: [started, failed] };
    }

    const finished = createEvent({
      type: 'memory.maintenance_finished',
      runId: maintenance.run.id,
      outcome: maintenance.run.outcome,
      summary: maintenance.run.summary,
      processedCandidateIds: maintenance.run.processedCandidateIds,
      failedCandidateIds: maintenance.run.failedCandidateIds,
      step: nextMemoryStep(options.trace),
    });
    options.onTraceEvent?.(finished);
    return { candidateIds, maintenance, events: [started, finished] };
  } catch (error) {
    const failed = createEvent({
      type: 'memory.maintenance_failed',
      runId,
      error: error instanceof Error ? error.message : String(error),
      candidateIds: observations.map((candidate) => candidate.id),
      step: nextMemoryStep(options.trace),
    });
    options.onTraceEvent?.(failed);
    return { candidateIds, events: [started, failed] };
  } finally {
    await lock?.release();
  }
}

async function acquireMemoryMaintenanceLock(options: {
  memoryRoot: string;
  staleAfterMs?: number;
  timeoutMs?: number;
}): Promise<{ release: () => Promise<void> }> {
  const memoryRoot = resolve(options.memoryRoot);
  const lockPath = join(memoryRoot, '_maintenance', 'maintenance.lock');
  const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_LOCK_STALE_AFTER_MS;
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({
        id: lockId,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      }) + '\n', 'utf8');
      await handle.close();

      return {
        async release() {
          await releaseMemoryMaintenanceLock(lockPath, lockId);
        },
      };
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }

      if (await removeStaleMemoryMaintenanceLock(lockPath, staleAfterMs)) {
        continue;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Memory maintenance lock is busy: ${lockPath}`);
      }
      await sleep(DEFAULT_LOCK_POLL_MS);
    }
  }
}

async function releaseMemoryMaintenanceLock(lockPath: string, lockId: string) {
  const current = await readMemoryMaintenanceLock(lockPath);
  if (current?.id !== lockId) {
    return;
  }
  await rm(lockPath, { force: true });
}

async function removeStaleMemoryMaintenanceLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  const current = await readMemoryMaintenanceLock(lockPath);
  if (!current) {
    return false;
  }

  const acquiredAt = Date.parse(current.acquiredAt);
  if (!Number.isFinite(acquiredAt) || Date.now() - acquiredAt < staleAfterMs) {
    return false;
  }

  await rm(lockPath, { force: true });
  return true;
}

async function readMemoryMaintenanceLock(lockPath: string): Promise<{ id: string; acquiredAt: string } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const candidate = parsed as Record<string, unknown>;
    return typeof candidate.id === 'string' && typeof candidate.acquiredAt === 'string' ?
      { id: candidate.id, acquiredAt: candidate.acquiredAt }
    : undefined;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    return undefined;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function enqueueMaintenance<T>(memoryRoot: string, run: () => Promise<T>): Promise<T> {
  const previous = maintenanceQueues.get(memoryRoot) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  maintenanceQueues.set(memoryRoot, queued);

  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (maintenanceQueues.get(memoryRoot) === queued) {
      maintenanceQueues.delete(memoryRoot);
    }
  }
}

function createEvent<T extends Omit<TraceEvent, 'timestamp'> & { type: TraceEvent['type'] }>(event: T): T & { timestamp: string } {
  return {
    ...event,
    timestamp: new Date().toISOString(),
  };
}

function nextMemoryStep(trace: TraceEvent[]): number {
  return trace.reduce((max, event) => 'step' in event ? Math.max(max, event.step) : max, 0) + 1;
}
