import { resolve } from 'node:path';
import compact from 'lodash/compact.js';
import { DEFAULT_OPENAI_MODEL, LlmAdapterService } from '@/advanced.js';
import { ProviderCredentialRepository } from '@/core/auth/index.js';
import { MemoryCatalogService } from '@/core/memory/catalog.js';
import { MemoryMaintenanceService } from '@/core/memory/maintainer.js';
import { MemoryValidationService } from '@/core/memory/validation.js';
import { MemoryVisibilityService } from '@/core/memory/visibility.js';
import type { MemoryValidationResult } from '@/core/memory/types.js';
import { LlmProviderRuntimeService } from '@/core/runtime/provider-runtime/index.js';
import type { CliV2CommandEdgeOptions } from './types.js';

export type MemoryCliCommand = 'status' | 'init' | 'list' | 'read' | 'search' | 'validate' | 'maintain';

export type MemoryCliCommandFlags = {
  path?: string;
  query?: string;
  offset?: number;
  maxLines?: number;
  maxResults?: number;
  repair?: boolean;
  dryRun?: boolean;
  reconcile?: boolean;
};

/**
 * Command edge for `heddle memory`.
 *
 * Owns: terminal subcommand dispatch, flag-to-service option parsing, provider
 * provider runtime selection for the explicit maintainer command, and terminal
 * formatting.
 *
 * Does not own: catalog invariants, note traversal/search semantics, memory
 * validation rules, candidate persistence, or maintainer behavior. Those stay
 * in `src/core/memory` public services.
 */
export class MemoryCliV2CommandEdgeService {
  static async run(
    command: MemoryCliCommand,
    options: CliV2CommandEdgeOptions,
    flags: MemoryCliCommandFlags = {},
  ): Promise<void> {
    const context = MemoryCliV2CommandEdgeService.createContext(options);
    const handlers: Record<MemoryCliCommand, () => Promise<void> | void> = {
      init: () => MemoryCliV2CommandEdgeService.runInit(context),
      status: () => MemoryCliV2CommandEdgeService.runStatus(context),
      list: () => MemoryCliV2CommandEdgeService.runList(context, flags),
      read: () => MemoryCliV2CommandEdgeService.runRead(context, flags),
      search: () => MemoryCliV2CommandEdgeService.runSearch(context, flags),
      validate: () => MemoryCliV2CommandEdgeService.runValidate(context, flags),
      maintain: () => MemoryCliV2CommandEdgeService.runMaintain(context, options, flags),
    };

    await handlers[command]();
  }

  private static createContext(options: CliV2CommandEdgeOptions) {
    const memoryRoot = resolve(options.workspaceRoot, options.stateDir, 'memory');
    return {
      memoryRoot,
      catalog: new MemoryCatalogService(memoryRoot),
      visibility: new MemoryVisibilityService(memoryRoot),
      validation: new MemoryValidationService(memoryRoot),
      maintenance: new MemoryMaintenanceService(memoryRoot),
    };
  }

  private static runInit(context: ReturnType<typeof MemoryCliV2CommandEdgeService.createContext>): void {
    const result = context.catalog.bootstrap();
    process.stdout.write(`Memory root: ${result.memoryRoot}\n`);
    process.stdout.write(
      result.createdPaths.length > 0 ?
        `Created:\n${MemoryCliV2CommandEdgeService.formatBulletList(result.createdPaths)}\n`
      : 'Memory workspace already initialized.\n',
    );
  }

  private static async runStatus(context: ReturnType<typeof MemoryCliV2CommandEdgeService.createContext>): Promise<void> {
    const result = await context.visibility.loadStatus();
    process.stdout.write([
      `Memory root: ${result.memoryRoot}`,
      `Catalog shape: ${result.catalog.ok ? 'ok' : 'missing required catalogs'}`,
      `Notes: ${result.notes.count}`,
      `Pending candidates: ${result.candidates.pending}`,
      result.runs.latest.length > 0 ?
        `Recent runs:\n${MemoryCliV2CommandEdgeService.formatBulletList(
          result.runs.latest.map((run) => `${run.id}: ${run.outcome}, ${run.processedCandidateIds.length}/${run.candidateIds.length} processed`),
        )}`
      : undefined,
      result.catalog.missing.length > 0 ?
        `Missing:\n${MemoryCliV2CommandEdgeService.formatBulletList(result.catalog.missing)}`
      : undefined,
    ].filter(Boolean).join('\n'));
    process.stdout.write('\n');
  }

  private static async runList(
    context: ReturnType<typeof MemoryCliV2CommandEdgeService.createContext>,
    flags: MemoryCliCommandFlags,
  ): Promise<void> {
    const notes = await context.visibility.listNotePaths(flags.path);
    process.stdout.write(`Memory root: ${context.memoryRoot}\n`);
    process.stdout.write(notes.length > 0 ? `${notes.join('\n')}\n` : 'No memory notes found.\n');
  }

  private static async runRead(
    context: ReturnType<typeof MemoryCliV2CommandEdgeService.createContext>,
    flags: MemoryCliCommandFlags,
  ): Promise<void> {
    if (!flags.path) {
      throw new Error('Usage: heddle memory read <path>');
    }
    process.stdout.write(await context.visibility.readNote({
      path: flags.path,
      offset: flags.offset,
      maxLines: flags.maxLines,
    }));
    process.stdout.write('\n');
  }

  private static async runSearch(
    context: ReturnType<typeof MemoryCliV2CommandEdgeService.createContext>,
    flags: MemoryCliCommandFlags,
  ): Promise<void> {
    if (!flags.query) {
      throw new Error('Usage: heddle memory search <query>');
    }
    process.stdout.write(await context.visibility.searchNotes({
      query: flags.query,
      path: flags.path,
      maxResults: flags.maxResults,
    }));
    process.stdout.write('\n');
  }

  private static async runValidate(
    context: ReturnType<typeof MemoryCliV2CommandEdgeService.createContext>,
    flags: MemoryCliCommandFlags,
  ): Promise<void> {
    if (flags.repair) {
      const repair = context.validation.repairMissingCatalogs();
      process.stdout.write(`Memory root: ${repair.memoryRoot}\n`);
      process.stdout.write(
        repair.createdPaths.length > 0 ?
          `Repaired missing catalogs:\n${MemoryCliV2CommandEdgeService.formatBulletList(repair.createdPaths)}\n`
        : 'No missing catalogs repaired.\n',
      );
    }

    MemoryCliV2CommandEdgeService.writeValidation(await context.validation.validate());
  }

  private static async runMaintain(
    context: ReturnType<typeof MemoryCliV2CommandEdgeService.createContext>,
    options: CliV2CommandEdgeOptions,
    flags: MemoryCliCommandFlags,
  ): Promise<void> {
    if (flags.reconcile) {
      const repair = context.validation.repairMissingCatalogs();
      if (repair.createdPaths.length > 0) {
        process.stdout.write(`Repaired missing catalogs:\n${MemoryCliV2CommandEdgeService.formatBulletList(repair.createdPaths)}\n`);
      }
    }

    const pending = await context.maintenance.readPendingCandidates();
    if (flags.dryRun) {
      process.stdout.write([
        `Memory root: ${context.memoryRoot}`,
        `Pending candidates: ${pending.length}`,
        ...pending.map((candidate) => `- ${candidate.id}: ${candidate.summary}`),
      ].join('\n'));
      process.stdout.write('\n');
      if (flags.reconcile) {
        MemoryCliV2CommandEdgeService.writeValidation(await context.validation.validate());
      }
      return;
    }

    if (pending.length === 0) {
      process.stdout.write(`Memory root: ${context.memoryRoot}\n`);
      process.stdout.write('No pending memory candidates.\n');
      if (flags.reconcile) {
        MemoryCliV2CommandEdgeService.writeValidation(await context.validation.validate());
      }
      return;
    }

    const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
    const credentialStorePath = ProviderCredentialRepository.resolveStorePath(resolve(options.workspaceRoot, options.stateDir));
    const providerRuntime = LlmProviderRuntimeService.resolve({
      model,
      credentialStorePath,
      preferApiKey: options.preferApiKey,
    });
    LlmProviderRuntimeService.assertRunnable(providerRuntime);

    const result = await context.maintenance.runBacklog({
      llm: LlmAdapterService.create({
        model,
        credentials: {
          apiKey: providerRuntime.apiKey,
          credentialStorePath,
        },
        runtime: providerRuntime.llmRuntime,
      }),
      source: 'heddle memory maintain',
    });

    process.stdout.write(compact([
      `Memory root: ${context.memoryRoot}`,
      `Run: ${result.run.id}`,
      `Outcome: ${result.run.outcome}`,
      `Summary: ${result.run.summary}`,
      `Candidates: ${result.run.processedCandidateIds.length}/${result.run.candidateIds.length} processed`,
      `Catalog shape: ${result.run.catalogValid ? 'ok' : 'missing required catalogs'}`,
      result.run.catalogMissing.length > 0 ?
        `Missing:\n${MemoryCliV2CommandEdgeService.formatBulletList(result.run.catalogMissing)}`
      : undefined,
    ]).join('\n'));
    process.stdout.write('\n');
    if (flags.reconcile) {
      MemoryCliV2CommandEdgeService.writeValidation(await context.validation.validate());
    }
  }

  private static writeValidation(result: MemoryValidationResult): void {
    const hasErrors = result.issues.some((issue) => issue.severity === 'error');
    const hasWarnings = result.issues.some((issue) => issue.severity === 'warning');
    const label =
      hasErrors ? 'issues found'
      : hasWarnings ? 'warnings'
      : 'ok';
    process.stdout.write(compact([
      `Memory root: ${result.memoryRoot}`,
      `Validation: ${label}`,
      `Issues: ${result.issueCount}`,
      result.issues.length > 0 ?
        MemoryCliV2CommandEdgeService.formatBulletList(
          result.issues.map((issue) => `[${issue.severity}] ${issue.type}: ${issue.message}`),
        )
      : undefined,
    ]).join('\n'));
    process.stdout.write('\n');
  }

  private static formatBulletList(values: string[]): string {
    return values.map((value) => `- ${value}`).join('\n');
  }
}
