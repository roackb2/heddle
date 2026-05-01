#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chdir } from 'node:process';
import { Command } from 'commander';
import { createLlmAdapter, DEFAULT_OPENAI_MODEL } from '../index.js';
import { bootstrapMemoryWorkspace } from '../core/memory/catalog.js';
import {
  readPendingKnowledgeCandidates,
  runKnowledgeMaintenanceForBacklog,
} from '../core/memory/maintainer.js';
import {
  listMemoryNotePaths,
  loadMemoryStatus,
  readMemoryNote,
  searchMemoryNotes,
} from '../core/memory/visibility.js';
import {
  repairMissingMemoryCatalogs,
  validateMemoryWorkspace,
} from '../core/memory/validation.js';
import { resolveApiKeyForModel } from '../core/runtime/api-keys.js';
import { runAuthCli } from './auth.js';
import { runAskCli } from './ask.js';
import { startChatCli } from './chat/index.js';
import { runDaemonCli } from './daemon.js';
import { runEvalCli } from './eval/index.js';
import { parseHeartbeatArgs, runHeartbeatCli } from './heartbeat.js';
import { runSessionCli } from './session.js';
import {
  daemonStartConflictMessage,
  embeddedCommandConflictMessage,
  formatRuntimeHostNotice,
  resolveWorkspaceRuntimeHost,
  type ResolvedRuntimeHost,
} from '../core/runtime/runtime-hosts.js';
import { registerKnownWorkspaces, resolveDaemonRegistryPath } from '../core/runtime/daemon-registry.js';
import { resolveWorkspaceContext } from '../core/runtime/workspaces.js';

type RootCliOptions = {
  cwd?: string;
  model?: string;
  maxSteps?: string;
  preferApiKey?: boolean;
  forceOwnerConflict?: boolean;
};

type HeddleProjectConfig = {
  model?: string;
  maxSteps?: number;
  stateDir?: string;
  directShellApproval?: 'always' | 'never';
  searchIgnoreDirs?: string[];
  agentContextPaths?: string[];
};

type ResolvedCliOptions = {
  workspaceRoot: string;
  model?: string;
  maxSteps?: number;
  preferApiKey: boolean;
  stateDir: string;
  directShellApproval: 'always' | 'never';
  searchIgnoreDirs: string[];
  systemContext?: string;
  runtimeHost: ResolvedRuntimeHost;
  forceOwnerConflict: boolean;
};

const DEFAULT_MODEL_FOR_CONFIG = 'gpt-5.4';
const CLI_VERSION = readCliVersion();

async function main() {
  const program = new Command();
  program
    .name('heddle')
    .description('Heddle CLI')
    .version(CLI_VERSION, '--version', 'print the installed Heddle version')
    .option('--cwd <path>', 'run against another workspace root')
    .option('--model <name>', 'choose the active model')
    .option('--max-steps <n>', 'limit the agent loop length')
    .option('--prefer-api-key', 'prefer environment API keys over stored OAuth credentials when both are available')
    .option('--force-owner-conflict', 'bypass live daemon ownership guards for this command');

  program
    .command('chat')
    .description('start the interactive chat UI')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      writeRuntimeHostNotice('chat', resolved.runtimeHost);
      startChatCli({
        ...resolved,
        runtimeHost: resolved.forceOwnerConflict ? undefined : resolved.runtimeHost,
      });
    });

  program
    .command('ask [goal...]')
    .description('run a one-shot ask against the workspace')
    .option('--session <id>', 'continue a saved chat session by id')
    .option('--latest', 'continue the most recently updated chat session')
    .option('--new-session [name]', 'create a fresh chat session and run this ask inside it')
    .action(async (goalParts: string[], askOptions: { session?: string; latest?: boolean; newSession?: string | boolean }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await runAskCli(goalParts.join(' ').trim(), {
        workspaceRoot: resolved.workspaceRoot,
        model: resolved.model,
        maxSteps: resolved.maxSteps,
        preferApiKey: resolved.preferApiKey,
        stateDir: resolved.stateDir,
        searchIgnoreDirs: resolved.searchIgnoreDirs,
        systemContext: resolved.systemContext,
        runtimeHost: resolved.forceOwnerConflict ? undefined : resolved.runtimeHost,
        sessionId: askOptions.session,
        latestSession: Boolean(askOptions.latest),
        createSessionName:
          askOptions.newSession === undefined || askOptions.newSession === false ? undefined
          : askOptions.newSession === true ? ''
          : askOptions.newSession,
      });
    });

  program
    .command('init')
    .description('create a heddle.config.json template in the workspace')
    .action(() => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      initializeProjectConfig(resolved.workspaceRoot);
    });

  const memoryCommand = program
    .command('memory')
    .description('manage workspace memory catalogs')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryCli('status', resolved);
    });

  memoryCommand
    .command('status')
    .description('show workspace memory catalog status')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryCli('status', resolved);
    });

  memoryCommand
    .command('init')
    .description('create the default workspace memory catalogs')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryCli('init', resolved);
    });

  memoryCommand
    .command('list [path]')
    .description('list markdown notes under workspace memory')
    .action(async (path?: string) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryCli('list', resolved, { path });
    });

  memoryCommand
    .command('read [path]')
    .description('read a memory note')
    .option('--offset <n>', '0-based line offset')
    .option('--max-lines <n>', 'maximum lines to print')
    .action(async (path: string | undefined, flags: { offset?: string; maxLines?: string }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryCli('read', resolved, {
        path,
        offset: parsePositiveInt(flags.offset),
        maxLines: parsePositiveInt(flags.maxLines),
      });
    });

  memoryCommand
    .command('search [query]')
    .description('search memory notes')
    .option('--path <path>', 'memory-relative path to search under')
    .option('--max-results <n>', 'maximum matching lines to print')
    .action(async (query: string | undefined, flags: { path?: string; maxResults?: string }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryCli('search', resolved, {
        query,
        path: flags.path,
        maxResults: parsePositiveInt(flags.maxResults),
      });
    });

  memoryCommand
    .command('validate')
    .description('validate memory catalog quality')
    .option('--repair', 'repair safe missing catalog issues')
    .action(async (flags: { repair?: boolean }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryValidateCli(resolved, { repair: Boolean(flags.repair) });
    });

  memoryCommand
    .command('maintain')
    .description('process pending memory candidates into cataloged notes')
    .option('--dry-run', 'show pending candidates without running the maintainer')
    .option('--reconcile', 'repair safe catalog issues before maintenance and report validation after')
    .action(async (options: { dryRun?: boolean; reconcile?: boolean }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runMemoryMaintainCli(resolved, {
        dryRun: Boolean(options.dryRun),
        reconcile: Boolean(options.reconcile),
      });
    });

  const authCommand = program
    .command('auth')
    .description('manage provider credentials')
    .action(async () => {
      await runAuthCli('status');
    });

  authCommand
    .command('login <provider>')
    .description('log in to a provider')
    .option('--no-browser', 'print the authorization URL without opening a browser')
    .action(async (provider: string, flags: { browser?: boolean }) => {
      await runAuthCli('login', provider, { openBrowser: flags.browser });
    });

  authCommand
    .command('status')
    .description('show stored provider credentials')
    .action(async () => {
      await runAuthCli('status');
    });

  authCommand
    .command('logout <provider>')
    .description('remove a stored provider credential')
    .action(async (provider: string) => {
      await runAuthCli('logout', provider);
    });

  program
    .command('eval [args...]')
    .description('run Heddle evaluation harnesses')
    .allowUnknownOption(true)
    .action(async (args: string[]) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await runEvalCli(args ?? [], {
        repoRoot: resolveHeddleRepoRoot(),
        model: resolved.model,
        maxSteps: resolved.maxSteps,
        preferApiKey: resolved.preferApiKey,
      });
    });

  program
    .command('heartbeat [args...]')
    .description('manage and run heartbeat tasks')
    .allowUnknownOption(true)
    .action(async (args: string[]) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      enforceHeartbeatOwnership(args ?? [], resolved.runtimeHost, resolved.forceOwnerConflict);
      writeRuntimeHostNotice('heartbeat', resolved.runtimeHost);
      await runHeartbeatCli(args ?? [], resolved);
    });

  program
    .command('daemon [args...]')
    .description('start the local Heddle daemon and control plane')
    .allowUnknownOption(true)
    .action(async (args: string[]) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      enforceDaemonStartOwnership(resolved.runtimeHost, resolved.forceOwnerConflict);
      await runDaemonCli(args ?? [], resolved);
    });

  program
    .command('session [args...]')
    .description('manage local chat session storage')
    .allowUnknownOption(true)
    .action(async (args: string[]) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      enforceEmbeddedOwnership('session', resolved.runtimeHost, resolved.forceOwnerConflict);
      writeRuntimeHostNotice('session', resolved.runtimeHost);
      await runSessionCli(args ?? [], resolved);
    });

  program
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      writeRuntimeHostNotice('chat', resolved.runtimeHost);
      startChatCli({
        ...resolved,
        runtimeHost: resolved.forceOwnerConflict ? undefined : resolved.runtimeHost,
      });
    });

  const argv = process.argv.slice(2);
  const knownCommand = argv[0];
  if (knownCommand && !isKnownCommand(knownCommand) && !knownCommand.startsWith('-')) {
    const resolved = resolveCliOptions(program.opts<RootCliOptions>());
    chdir(resolved.workspaceRoot);
    await runAskCli(argv.join(' ').trim(), {
      workspaceRoot: resolved.workspaceRoot,
      model: resolved.model,
      maxSteps: resolved.maxSteps,
      stateDir: resolved.stateDir,
      searchIgnoreDirs: resolved.searchIgnoreDirs,
      systemContext: resolved.systemContext,
      runtimeHost: resolved.forceOwnerConflict ? undefined : resolved.runtimeHost,
      preferApiKey: resolved.preferApiKey,
    });
    return;
  }

  await program.parseAsync(process.argv);
}

function isKnownCommand(command: string): boolean {
  return ['chat', 'ask', 'init', 'memory', 'auth', 'eval', 'heartbeat', 'daemon', 'session', 'help'].includes(command);
}

async function runMemoryCli(
  command: 'status' | 'init' | 'list' | 'read' | 'search',
  options: ResolvedCliOptions,
  flags: {
    path?: string;
    query?: string;
    offset?: number;
    maxLines?: number;
    maxResults?: number;
  } = {},
) {
  const memoryRoot = resolve(options.workspaceRoot, options.stateDir, 'memory');

  if (command === 'init') {
    const result = bootstrapMemoryWorkspace({ memoryRoot });
    process.stdout.write(`Memory root: ${result.memoryRoot}\n`);
    process.stdout.write(
      result.createdPaths.length > 0 ?
        `Created:\n${result.createdPaths.map((path) => `- ${path}`).join('\n')}\n`
      : 'Memory workspace already initialized.\n',
    );
    return;
  }

  if (command === 'status') {
    const result = await loadMemoryStatus({ memoryRoot });
    process.stdout.write(`Memory root: ${result.memoryRoot}\n`);
    process.stdout.write(`Catalog shape: ${result.catalog.ok ? 'ok' : 'missing required catalogs'}\n`);
    process.stdout.write(`Notes: ${result.notes.count}\n`);
    process.stdout.write(`Pending candidates: ${result.candidates.pending}\n`);
    if (result.runs.latest.length > 0) {
      process.stdout.write('Recent runs:\n');
      for (const run of result.runs.latest) {
        process.stdout.write(`- ${run.id}: ${run.outcome}, ${run.processedCandidateIds.length}/${run.candidateIds.length} processed\n`);
      }
    }
    if (result.catalog.missing.length > 0) {
      process.stdout.write(`Missing:\n${result.catalog.missing.map((path) => `- ${path}`).join('\n')}\n`);
    }
    return;
  }

  if (command === 'list') {
    const notes = await listMemoryNotePaths({ memoryRoot, path: flags.path });
    process.stdout.write(`Memory root: ${memoryRoot}\n`);
    process.stdout.write(notes.length > 0 ? `${notes.join('\n')}\n` : 'No memory notes found.\n');
    return;
  }

  if (command === 'read') {
    if (!flags.path) {
      throw new Error('Usage: heddle memory read <path>');
    }
    process.stdout.write(await readMemoryNote({
      memoryRoot,
      path: flags.path,
      offset: flags.offset,
      maxLines: flags.maxLines,
    }));
    process.stdout.write('\n');
    return;
  }

  if (command === 'search') {
    if (!flags.query) {
      throw new Error('Usage: heddle memory search <query>');
    }
    process.stdout.write(await searchMemoryNotes({
      memoryRoot,
      query: flags.query,
      path: flags.path,
      maxResults: flags.maxResults,
    }));
    process.stdout.write('\n');
    return;
  }

  const exhaustive: never = command;
  throw new Error(`Unsupported memory command: ${exhaustive}`);
}

async function runMemoryValidateCli(options: ResolvedCliOptions, flags: { repair: boolean }) {
  const memoryRoot = resolve(options.workspaceRoot, options.stateDir, 'memory');
  if (flags.repair) {
    const repair = await repairMissingMemoryCatalogs({ memoryRoot });
    process.stdout.write(`Memory root: ${repair.memoryRoot}\n`);
    process.stdout.write(
      repair.createdPaths.length > 0 ?
        `Repaired missing catalogs:\n${repair.createdPaths.map((path) => `- ${path}`).join('\n')}\n`
      : 'No missing catalogs repaired.\n',
    );
  }

  const validation = await validateMemoryWorkspace({ memoryRoot });
  writeMemoryValidation(validation);
}

async function runMemoryMaintainCli(options: ResolvedCliOptions, flags: { dryRun: boolean; reconcile: boolean }) {
  const memoryRoot = resolve(options.workspaceRoot, options.stateDir, 'memory');
  if (flags.reconcile) {
    const repair = await repairMissingMemoryCatalogs({ memoryRoot });
    if (repair.createdPaths.length > 0) {
      process.stdout.write(`Repaired missing catalogs:\n${repair.createdPaths.map((path) => `- ${path}`).join('\n')}\n`);
    }
  }
  const pending = await readPendingKnowledgeCandidates({ memoryRoot });

  if (flags.dryRun) {
    process.stdout.write(`Memory root: ${memoryRoot}\n`);
    process.stdout.write(`Pending candidates: ${pending.length}\n`);
    for (const candidate of pending) {
      process.stdout.write(`- ${candidate.id}: ${candidate.summary}\n`);
    }
    if (flags.reconcile) {
      writeMemoryValidation(await validateMemoryWorkspace({ memoryRoot }));
    }
    return;
  }

  if (pending.length === 0) {
    process.stdout.write(`Memory root: ${memoryRoot}\n`);
    process.stdout.write('No pending memory candidates.\n');
    if (flags.reconcile) {
      writeMemoryValidation(await validateMemoryWorkspace({ memoryRoot }));
    }
    return;
  }

  const model = options.model ?? process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_OPENAI_MODEL;
  const apiKey = resolveApiKeyForModel(model);
  if (!apiKey) {
    throw new Error(`Missing provider API key for memory maintainer model: ${model}`);
  }

  const result = await runKnowledgeMaintenanceForBacklog({
    memoryRoot,
    llm: createLlmAdapter({ model, apiKey }),
    source: 'heddle memory maintain',
  });

  process.stdout.write(`Memory root: ${memoryRoot}\n`);
  process.stdout.write(`Run: ${result.run.id}\n`);
  process.stdout.write(`Outcome: ${result.run.outcome}\n`);
  process.stdout.write(`Summary: ${result.run.summary}\n`);
  process.stdout.write(`Candidates: ${result.run.processedCandidateIds.length}/${result.run.candidateIds.length} processed\n`);
  process.stdout.write(`Catalog shape: ${result.run.catalogValid ? 'ok' : 'missing required catalogs'}\n`);
  if (result.run.catalogMissing.length > 0) {
    process.stdout.write(`Missing:\n${result.run.catalogMissing.map((path) => `- ${path}`).join('\n')}\n`);
  }
  if (flags.reconcile) {
    writeMemoryValidation(await validateMemoryWorkspace({ memoryRoot }));
  }
}

function writeMemoryValidation(result: Awaited<ReturnType<typeof validateMemoryWorkspace>>) {
  const hasErrors = result.issues.some((issue) => issue.severity === 'error');
  const hasWarnings = result.issues.some((issue) => issue.severity === 'warning');
  const label =
    hasErrors ? 'issues found'
    : hasWarnings ? 'warnings'
    : 'ok';
  process.stdout.write(`Memory root: ${result.memoryRoot}\n`);
  process.stdout.write(`Validation: ${label}\n`);
  process.stdout.write(`Issues: ${result.issueCount}\n`);
  for (const issue of result.issues) {
    process.stdout.write(`- [${issue.severity}] ${issue.type}: ${issue.message}\n`);
  }
}

function resolveCliOptions(flags: RootCliOptions): ResolvedCliOptions {
  const workspaceRoot = resolve(flags.cwd ?? process.cwd());
  const projectConfig = loadProjectConfig(workspaceRoot);
  const stateRoot = resolve(workspaceRoot, projectConfig.stateDir ?? '.heddle');
  const workspaceContext = resolveWorkspaceContext({
    workspaceRoot,
    stateRoot,
  });
  registerKnownWorkspaces({
    registryPath: resolveDaemonRegistryPath(),
    workspaces: workspaceContext.workspaces,
  });
  return {
    workspaceRoot,
    model: flags.model ?? projectConfig.model,
    maxSteps: parsePositiveInt(flags.maxSteps) ?? projectConfig.maxSteps,
    preferApiKey: Boolean(flags.preferApiKey),
    stateDir: projectConfig.stateDir ?? '.heddle',
    directShellApproval: projectConfig.directShellApproval ?? 'never',
    searchIgnoreDirs: projectConfig.searchIgnoreDirs ?? [],
    systemContext: loadProjectAgentContext(workspaceRoot, projectConfig.agentContextPaths ?? ['AGENTS.md']),
    runtimeHost: resolveWorkspaceRuntimeHost({
      workspaceRoot,
      stateRoot,
    }),
    forceOwnerConflict: Boolean(flags.forceOwnerConflict),
  };
}

function writeRuntimeHostNotice(command: string, runtimeHost: ResolvedRuntimeHost) {
  const notice = formatRuntimeHostNotice(command, runtimeHost);
  if (!notice) {
    return;
  }

  process.stdout.write(`${notice}\n`);
}

function enforceEmbeddedOwnership(command: string, runtimeHost: ResolvedRuntimeHost, forceOwnerConflict: boolean) {
  if (forceOwnerConflict) {
    return;
  }

  const message = embeddedCommandConflictMessage(command, runtimeHost);
  if (message) {
    throw new Error(message);
  }
}

function enforceDaemonStartOwnership(runtimeHost: ResolvedRuntimeHost, forceOwnerConflict: boolean) {
  if (forceOwnerConflict) {
    return;
  }

  const message = daemonStartConflictMessage(runtimeHost);
  if (message) {
    throw new Error(message);
  }
}

function enforceHeartbeatOwnership(args: string[], runtimeHost: ResolvedRuntimeHost, forceOwnerConflict: boolean) {
  if (forceOwnerConflict) {
    return;
  }

  const parsed = parseHeartbeatArgs(args);
  if (parsed.command === 'help' || parsed.command === 'runs') {
    return;
  }
  if (parsed.command === 'task' && (parsed.subcommand === 'list' || parsed.subcommand === 'show')) {
    return;
  }

  const message = embeddedCommandConflictMessage('heartbeat', runtimeHost);
  if (message) {
    throw new Error(message);
  }
}

function readCliVersion(): string {
  for (const candidatePath of resolvePackageJsonCandidates()) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      const raw = readFileSync(candidatePath, 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim()) {
        return parsed.version;
      }
    } catch {
      continue;
    }
  }

  return '0.0.0';
}

function resolvePackageJsonCandidates(): string[] {
  return [
    resolve(import.meta.dirname, '../../package.json'),
    resolve(import.meta.dirname, '../../../package.json'),
  ];
}

function resolveHeddleRepoRoot(): string {
  for (const candidatePath of resolvePackageJsonCandidates()) {
    if (existsSync(candidatePath)) {
      return dirname(candidatePath);
    }
  }
  return resolve(import.meta.dirname, '../..');
}

function loadProjectConfig(workspaceRoot: string): HeddleProjectConfig {
  const configPath = resolve(workspaceRoot, 'heddle.config.json');
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      model: typeof candidate.model === 'string' ? candidate.model : undefined,
      maxSteps:
        typeof candidate.maxSteps === 'number' && Number.isFinite(candidate.maxSteps) && candidate.maxSteps > 0 ?
          candidate.maxSteps
        : undefined,
      stateDir: typeof candidate.stateDir === 'string' ? candidate.stateDir : undefined,
      directShellApproval:
        candidate.directShellApproval === 'always' || candidate.directShellApproval === 'never' ?
          candidate.directShellApproval
        : undefined,
      searchIgnoreDirs:
        Array.isArray(candidate.searchIgnoreDirs) && candidate.searchIgnoreDirs.every((value) => typeof value === 'string') ?
          candidate.searchIgnoreDirs
        : undefined,
      agentContextPaths:
        Array.isArray(candidate.agentContextPaths) && candidate.agentContextPaths.every((value) => typeof value === 'string') ?
          candidate.agentContextPaths
        : undefined,
    };
  } catch {
    return {};
  }
}

function initializeProjectConfig(workspaceRoot: string) {
  const configPath = resolve(workspaceRoot, 'heddle.config.json');
  if (existsSync(configPath)) {
    process.stdout.write(`heddle.config.json already exists at ${configPath}\n`);
    return;
  }

  const template = {
    model: DEFAULT_MODEL_FOR_CONFIG,
    maxSteps: 100,
    stateDir: '.heddle',
    directShellApproval: 'never',
    searchIgnoreDirs: ['.git', 'dist', 'node_modules', '.heddle'],
    agentContextPaths: ['AGENTS.md'],
  };
  writeFileSync(configPath, `${JSON.stringify(template, null, 2)}\n`);
  process.stdout.write(`Created ${configPath}\n`);
}

function loadProjectAgentContext(workspaceRoot: string, paths: string[]): string | undefined {
  const sections = paths.flatMap((relativePath) => {
    const filePath = resolve(workspaceRoot, relativePath);
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = readFileSync(filePath, 'utf8').trim();
      if (!content) {
        return [];
      }
      return [`Source: ${relativePath}\n${truncate(content, 12000)}`];
    } catch {
      return [];
    }
  });

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('Usage: ')) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
