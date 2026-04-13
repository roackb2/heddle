import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import OpenAI from 'openai';
import type { TraceEvent } from '../types.js';
import {
  createCyberLoopObserver,
  createRuntimeFrameEmbedder,
  type CyberLoopCompatibleMiddleware,
  type CyberLoopObserver,
  type CyberLoopObserverAnnotation,
  type HeddleRuntimeFrame,
} from './cyberloop.js';

export type CyberLoopKinematicsObserver = {
  observer: CyberLoopObserver;
  annotations: TraceEvent[];
};

export type CreateCyberLoopKinematicsObserverOptions = {
  goal: string;
  referenceText?: string;
  apiKey?: string;
  embeddingModel?: string;
  stabilityThreshold?: number;
  moduleSpecifier?: string;
  onAnnotation?: (annotation: CyberLoopObserverAnnotation) => void;
  onError?: (error: unknown) => void;
  _testOverrides?: {
    advancedModule?: CyberLoopAdvancedModule;
    embedText?: (text: string) => Promise<number[]>;
  };
};

type CyberLoopAdvancedModule = {
  kinematicsMiddleware: (options: {
    embedder: { embed: (state: HeddleRuntimeFrame) => Promise<number[]> };
    goalEmbedding: number[];
    pid?: {
      Kp?: number;
      Ki?: number;
      Kd?: number;
      stabilityThreshold?: number;
    };
    physics?: {
      processNoise?: number;
      measureNoise?: number;
    };
  }) => CyberLoopCompatibleMiddleware<HeddleRuntimeFrame>;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export async function createCyberLoopKinematicsObserver(
  options: CreateCyberLoopKinematicsObserverOptions,
): Promise<CyberLoopKinematicsObserver> {
  const apiKey = firstDefinedNonEmpty(options.apiKey, process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error('CyberLoop drift detection requires OPENAI_API_KEY or PERSONAL_OPENAI_API_KEY for embeddings.');
  }

  const cyberloop = options._testOverrides?.advancedModule ?? await importCyberLoopAdvanced(options.moduleSpecifier ?? process.env.HEDDLE_CYBERLOOP_ADVANCED_MODULE);
  const client = new OpenAI({ apiKey });
  const embeddingModel = options.embeddingModel ?? process.env.HEDDLE_DRIFT_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const embedText = options._testOverrides?.embedText ?? (async (text: string) => {
    const response = await client.embeddings.create({
      model: embeddingModel,
      input: text,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error('OpenAI embeddings response did not include an embedding vector.');
    }
    return embedding;
  });
  const frameEmbedder = createRuntimeFrameEmbedder({ embedText });
  const referenceText = options.referenceText?.trim();
  const goalEmbedding = await embedText(referenceText || options.goal);
  const annotations: TraceEvent[] = [];

  const observer = createCyberLoopObserver({
    baselineFrame: referenceText ?
      (event) => ({
        runId: event.runId,
        step: 0,
        kind: 'assistant',
        goal: event.goal,
        text: referenceText,
        timestamp: event.timestamp,
        rawEvent: event,
      })
    : undefined,
    shouldObserveFrame: (frame) => frame.kind === 'assistant' || frame.kind === 'final',
    middleware: [
      cyberloop.kinematicsMiddleware({
        embedder: frameEmbedder,
        goalEmbedding,
        pid: {
          stabilityThreshold: options.stabilityThreshold ?? readStabilityThreshold(),
        },
      }),
    ],
    onAnnotation(annotation) {
      annotations.push(toCyberLoopTraceEvent(annotation));
      options.onAnnotation?.(annotation);
    },
    onError: options.onError,
  });

  return { observer, annotations };
}

function readStabilityThreshold(): number {
  const raw = process.env.HEDDLE_DRIFT_STABILITY_THRESHOLD;
  if (!raw) {
    return 0.05;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.05;
}

function toCyberLoopTraceEvent(annotation: CyberLoopObserverAnnotation): TraceEvent {
  return {
    type: 'cyberloop.annotation',
    step: annotation.step,
    frameKind: annotation.frame.kind,
    driftLevel: annotation.driftLevel,
    requestedHalt: annotation.requestedHalt,
    metadata: annotation.metadata,
    timestamp: annotation.timestamp,
  };
}

async function importCyberLoopAdvanced(moduleSpecifier: string | undefined): Promise<CyberLoopAdvancedModule> {
  const specifier = moduleSpecifier ? normalizeImportSpecifier(moduleSpecifier) : 'cyberloop/advanced';
  try {
    const mod = await import(specifier) as Partial<CyberLoopAdvancedModule>;
    if (typeof mod.kinematicsMiddleware !== 'function') {
      throw new Error(`Module ${specifier} does not export kinematicsMiddleware.`);
    }
    return { kinematicsMiddleware: mod.kinematicsMiddleware };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load CyberLoop kinematics middleware from ${specifier}. Install the optional peer dependency cyberloop in the same environment as Heddle, or set HEDDLE_CYBERLOOP_ADVANCED_MODULE to a local advanced middleware module. ${detail}`,
    );
  }
}

function normalizeImportSpecifier(specifier: string): string {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return pathToFileURL(resolve(specifier)).href;
  }

  return specifier;
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
