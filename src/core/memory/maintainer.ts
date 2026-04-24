import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { LlmAdapter } from '../llm/types.js';
import type { RunResult } from '../types.js';
import { runAgent } from '../agent/run-agent.js';
import { createLogger } from '../utils/logger.js';
import { bootstrapMemoryWorkspace, loadMemoryRootCatalog, validateMemoryCatalogShape } from './catalog.js';
import { createMemoryMaintainerTools } from './maintainer-tools.js';

export type KnowledgeCandidate = {
  id: string;
  recordedAt: string;
  status: 'pending';
  summary: string;
  evidence?: string[];
  categoryHint?: string;
  importance?: 'low' | 'medium' | 'high';
  confidence?: 'user-stated' | 'tool-verified' | 'inferred' | 'historical';
  sourceRefs?: string[];
};

export type KnowledgeMaintenanceRunRecord = {
  id: string;
  startedAt: string;
  finishedAt: string;
  source: string;
  outcome: RunResult['outcome'] | 'skipped';
  summary: string;
  candidateIds: string[];
  processedCandidateIds: string[];
  failedCandidateIds: string[];
  catalogValid: boolean;
  catalogMissing: string[];
};

export type RunKnowledgeMaintenanceOptions = {
  memoryRoot: string;
  observations: KnowledgeCandidate[];
  llm: LlmAdapter;
  source: string;
  maxSteps?: number;
  now?: () => Date;
  nextRunId?: () => string;
};

export type RunKnowledgeMaintenanceResult = {
  run: KnowledgeMaintenanceRunRecord;
  result?: RunResult;
};

export async function readPendingKnowledgeCandidates(options: { memoryRoot: string }): Promise<KnowledgeCandidate[]> {
  const memoryRoot = resolve(options.memoryRoot);
  const candidatesPath = join(memoryRoot, '_maintenance', 'candidates.jsonl');
  const lines = await readJsonlLines(candidatesPath);
  const processed = new Set<string>();
  const pending: KnowledgeCandidate[] = [];

  for (const line of lines) {
    const parsed = parseJsonObject(line);
    if (!parsed) {
      continue;
    }

    if (parsed.kind === 'candidate_status' && typeof parsed.candidateId === 'string' && parsed.status === 'processed') {
      processed.add(parsed.candidateId);
      continue;
    }

    if (isKnowledgeCandidate(parsed)) {
      pending.push(parsed);
    }
  }

  return pending.filter((candidate) => !processed.has(candidate.id));
}

export async function runKnowledgeMaintenance(options: RunKnowledgeMaintenanceOptions): Promise<RunKnowledgeMaintenanceResult> {
  const memoryRoot = resolve(options.memoryRoot);
  bootstrapMemoryWorkspace({ memoryRoot });
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const runId = options.nextRunId?.() ?? `memory-run-${startedAt.getTime()}`;
  const candidateIds = options.observations.map((candidate) => candidate.id);
  const skippedCandidateIds = options.observations
    .filter((candidate) => !isMaintainerCandidateAllowed(candidate))
    .map((candidate) => candidate.id);
  const observations = options.observations.filter(isMaintainerCandidateAllowed);

  if (observations.length === 0) {
    const validation = validateMemoryCatalogShape({ memoryRoot });
    const summary =
      candidateIds.length === 0 ? 'No pending knowledge candidates.'
      : `Skipped ${candidateIds.length} low-value, duplicate, or secret-like memory candidate(s).`;
    const run = {
      id: runId,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      source: options.source,
      outcome: 'skipped' as const,
      summary,
      candidateIds,
      processedCandidateIds: [],
      failedCandidateIds: skippedCandidateIds,
      catalogValid: validation.ok,
      catalogMissing: validation.missing,
    };
    await appendMaintenanceRun(memoryRoot, run);
    return { run };
  }

  const rootCatalog = loadMemoryRootCatalog({ memoryRoot }).content;
  const goal = buildMaintenanceGoal(observations);
  const systemContext = buildMaintainerSystemContext(rootCatalog);
  const result = await runAgent({
    goal,
    llm: options.llm,
    tools: createMemoryMaintainerTools({ memoryRoot }),
    maxSteps: options.maxSteps ?? 40,
    logger: createLogger({ console: false, level: 'silent' }),
    systemContext,
  });
  const validation = validateMemoryCatalogShape({ memoryRoot });
  const processedCandidateIds = result.outcome === 'done' ? observations.map((candidate) => candidate.id) : [];
  const failedCandidateIds = result.outcome === 'done' ? skippedCandidateIds : candidateIds;
  const run = {
    id: runId,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    source: options.source,
    outcome: result.outcome,
    summary: result.summary,
    candidateIds,
    processedCandidateIds,
    failedCandidateIds,
    catalogValid: validation.ok,
    catalogMissing: validation.missing,
  };

  await appendMaintenanceRun(memoryRoot, run);
  if (processedCandidateIds.length > 0) {
    await appendCandidateStatusEvents(memoryRoot, processedCandidateIds, run.id, now);
  }

  return { run, result };
}

function isMaintainerCandidateAllowed(candidate: KnowledgeCandidate): boolean {
  const text = [
    candidate.summary,
    ...(candidate.evidence ?? []),
    ...(candidate.sourceRefs ?? []),
  ].join('\n');
  return !containsSecretLikeText(text);
}

export async function runKnowledgeMaintenanceForBacklog(options: Omit<RunKnowledgeMaintenanceOptions, 'observations'>): Promise<RunKnowledgeMaintenanceResult> {
  const observations = await readPendingKnowledgeCandidates({ memoryRoot: options.memoryRoot });
  return await runKnowledgeMaintenance({ ...options, observations });
}

function buildMaintainerSystemContext(rootCatalog: string): string {
  return [
    '## Memory Maintainer Mode',
    '',
    'You maintain Heddle workspace memory. You are not doing general coding work.',
    'Use only memory tools. Do not ask for shell, code edit, web, or external tools.',
    '',
    'Hard invariants:',
    '- Every durable note must be discoverable through the root catalog or a folder catalog.',
    '- Read the root catalog first, then read the relevant folder catalog before writing.',
    '- Search existing notes before creating a new note.',
    '- Prefer updating existing notes over creating duplicates.',
    '- Update folder catalogs whenever you create, rename, or retire a note.',
    '- Update the root catalog only when a new high-value note or discovery path matters globally.',
    '- Do not store secrets, credentials, private keys, tokens, or passwords.',
    '- Skip low-value, duplicate, speculative, or one-turn scratch observations.',
    '',
    'Loaded root catalog:',
    '',
    rootCatalog,
  ].join('\n');
}

function buildMaintenanceGoal(observations: KnowledgeCandidate[]): string {
  return [
    'Process these pending memory candidates into maintained cataloged memory.',
    '',
    ...observations.map((candidate, index) => [
      `Candidate ${index + 1}: ${candidate.id}`,
      `Summary: ${candidate.summary}`,
      candidate.categoryHint ? `Category hint: ${candidate.categoryHint}` : undefined,
      candidate.importance ? `Importance: ${candidate.importance}` : undefined,
      candidate.confidence ? `Confidence: ${candidate.confidence}` : undefined,
      candidate.evidence?.length ? `Evidence:\n${candidate.evidence.map((item) => `- ${item}`).join('\n')}` : undefined,
      candidate.sourceRefs?.length ? `Source refs: ${candidate.sourceRefs.join(', ')}` : undefined,
    ].filter((line): line is string => Boolean(line)).join('\n')),
    '',
    'End with a concise summary of what memory notes or catalogs changed, or why candidates were skipped.',
  ].join('\n\n');
}

async function appendMaintenanceRun(memoryRoot: string, run: KnowledgeMaintenanceRunRecord) {
  const path = join(memoryRoot, '_maintenance', 'runs.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(run)}\n`, 'utf8');
}

async function appendCandidateStatusEvents(memoryRoot: string, candidateIds: string[], runId: string, now: () => Date) {
  const path = join(memoryRoot, '_maintenance', 'candidates.jsonl');
  await mkdir(dirname(path), { recursive: true });
  const recordedAt = now().toISOString();
  await appendFile(
    path,
    candidateIds.map((candidateId) => JSON.stringify({
      kind: 'candidate_status',
      candidateId,
      status: 'processed',
      runId,
      recordedAt,
    })).join('\n') + '\n',
    'utf8',
  );
}

async function readJsonlLines(path: string): Promise<string[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split(/\r?\n/u).filter((line) => line.trim());
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function isKnowledgeCandidate(value: Record<string, unknown>): value is KnowledgeCandidate {
  return typeof value.id === 'string'
    && typeof value.recordedAt === 'string'
    && value.status === 'pending'
    && typeof value.summary === 'string'
    && (value.evidence === undefined || isStringArray(value.evidence))
    && (value.categoryHint === undefined || typeof value.categoryHint === 'string')
    && (value.importance === undefined || value.importance === 'low' || value.importance === 'medium' || value.importance === 'high')
    && (value.confidence === undefined || value.confidence === 'user-stated' || value.confidence === 'tool-verified' || value.confidence === 'inferred' || value.confidence === 'historical')
    && (value.sourceRefs === undefined || isStringArray(value.sourceRefs));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function containsSecretLikeText(value: string): boolean {
  const normalized = value.toLowerCase();
  return /\b(api[_ -]?key|password|passwd|private[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer\s+[a-z0-9._~+/=-]{12,})\b/i.test(value)
    || /\bsecret\s*[:=]\s*\S{8,}/i.test(value)
    || /\bsk-[a-z0-9_-]{12,}\b/i.test(value)
    || normalized.includes('-----begin private key-----')
    || normalized.includes('-----begin rsa private key-----')
    || normalized.includes('-----begin openssh private key-----');
}
