#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chdir } from 'node:process';
import { Command } from 'commander';
import { AuthCliCommandEdgeService } from '@/cli-v2/commands/auth-command.js';
import { AskCliV2CommandEdgeService } from '@/cli-v2/commands/ask-command.js';
import { ChatCliV2CommandEdgeService } from '@/cli-v2/commands/chat-v2-command.js';
import { DaemonCliV2CommandEdgeService } from '@/cli-v2/commands/daemon-command.js';
import { EvalCliV2CommandEdgeService } from '@/cli-v2/commands/eval-command.js';
import { HeartbeatCliCommandEdgeService } from '@/cli-v2/commands/heartbeat-command.js';
import { InitCliV2CommandEdgeService } from '@/cli-v2/commands/init-command.js';
import { MemoryCliV2CommandEdgeService } from '@/cli-v2/commands/memory-command.js';
import type { CliV2CommandEdgeOptions } from '@/cli-v2/commands/types.js';
import { CliV2ProjectAgentContextService } from './services/project-agent-context-service.js';
import { RuntimeHostResolver } from '@/core/runtime/daemon/index.js';
import { FileDaemonRegistryRepository, RuntimeDaemonRegistryService } from '@/core/runtime/daemon/index.js';
import { ProjectConfigService } from '@/core/project-config/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { ProviderCredentialRepository } from '@/core/auth/index.js';

type RootCliOptions = {
  cwd?: string;
  model?: string;
  maxSteps?: string;
  preferApiKey?: boolean;
  forceOwnerConflict?: boolean;
};

type ResolvedCliOptions = CliV2CommandEdgeOptions;

const CLI_VERSION = readCliVersion();
const KNOWN_COMMANDS = new Set(['chat', 'chat-v2', 'ask', 'init', 'memory', 'auth', 'eval', 'heartbeat', 'daemon', 'help']);
const REMOVED_COMMAND_MESSAGES = new Map<string, string>([
  ['chat-v1', 'heddle chat-v1 has been removed from the public CLI. Use `heddle` or `heddle chat` for the supported terminal UI.'],
]);

/**
 * Owns the public Heddle terminal host bootstrap.
 *
 * This entrypoint resolves workspace-scoped host context and delegates command
 * execution to `cli-v2` command edge services. It must not absorb runtime
 * domain policy that belongs to shared APIs, server lifecycle, or core
 * services.
 */
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
    .description('start the API-backed interactive chat UI')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await ChatCliV2CommandEdgeService.run(resolved);
    });

  program
    .command('chat-v2')
    .description('start the API-backed interactive chat UI')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await ChatCliV2CommandEdgeService.run(resolved);
    });

  program
    .command('ask [goal...]')
    .description('run a one-shot ask against the workspace')
    .option('--session <id>', 'continue a saved chat session by id')
    .option('--latest', 'continue the most recently updated chat session')
    .option('--new-session [name]', 'create a fresh chat session and run this ask inside it')
    .option('--agent <id>', 'custom agent id for this ask turn')
    .option('--mode <mode>', 'built-in custom agent mode: ask, code, or review')
    .action(async (goalParts: string[], askOptions: {
      session?: string;
      latest?: boolean;
      newSession?: string | boolean;
      agent?: string;
      mode?: string;
    }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await AskCliV2CommandEdgeService.run(goalParts.join(' ').trim(), {
        workspaceRoot: resolved.workspaceRoot,
        activeWorkspaceId: resolved.activeWorkspaceId,
        model: resolved.model,
        maxSteps: resolved.maxSteps,
        preferApiKey: resolved.preferApiKey,
        stateDir: resolved.stateDir,
        searchIgnoreDirs: resolved.searchIgnoreDirs,
        systemContext: resolved.systemContext,
        runtimeHost: resolved.runtimeHost,
        forceOwnerConflict: resolved.forceOwnerConflict,
        sessionId: askOptions.session,
        latestSession: Boolean(askOptions.latest),
        createSessionName:
          askOptions.newSession === undefined || askOptions.newSession === false ? undefined
          : askOptions.newSession === true ? ''
          : askOptions.newSession,
        agentProfileId: resolveAskAgentProfileId(askOptions),
      });
    });

  program
    .command('init')
    .description('create a local .heddle/config.json template in the workspace')
    .action(() => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      InitCliV2CommandEdgeService.run({ workspaceRoot: resolved.workspaceRoot });
    });

  const memoryCommand = program
    .command('memory')
    .description('manage workspace memory catalogs')
    .addHelpCommand('help [command]', 'display help for command')
    .addHelpText('after', ['', 'Examples:', '  heddle memory status', '  heddle memory list workflows', '  heddle memory read workflows/release.md', '  heddle memory search "release checklist"', ''].join('\n'))
    .action(() => {
      memoryCommand.outputHelp();
    });

  memoryCommand
    .command('status')
    .description('show workspace memory catalog status')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await MemoryCliV2CommandEdgeService.run('status', resolved);
    });

  memoryCommand
    .command('init')
    .description('create the default workspace memory catalogs')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await MemoryCliV2CommandEdgeService.run('init', resolved);
    });

  memoryCommand
    .command('list [path]')
    .description('list markdown notes under workspace memory')
    .addHelpText('after', ['', 'Examples:', '  heddle memory list', '  heddle memory list workflows', ''].join('\n'))
    .action(async (path?: string) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await MemoryCliV2CommandEdgeService.run('list', resolved, { path });
    });

  memoryCommand
    .command('read [path]')
    .description('read a memory note')
    .option('--offset <n>', '0-based line offset')
    .option('--max-lines <n>', 'maximum lines to print')
    .addHelpText('after', ['', 'Examples:', '  heddle memory read workflows/release.md', '  heddle memory read workflows/release.md --offset 20 --max-lines 40', ''].join('\n'))
    .action(async (path: string | undefined, flags: { offset?: string; maxLines?: string }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await MemoryCliV2CommandEdgeService.run('read', resolved, {
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
    .addHelpText('after', ['', 'Examples:', '  heddle memory search "release checklist"', '  heddle memory search "daemon registry" --path architecture --max-results 10', ''].join('\n'))
    .action(async (query: string | undefined, flags: { path?: string; maxResults?: string }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await MemoryCliV2CommandEdgeService.run('search', resolved, {
        query,
        path: flags.path,
        maxResults: parsePositiveInt(flags.maxResults),
      });
    });

  memoryCommand
    .command('validate')
    .description('validate memory catalog quality')
    .option('--repair', 'repair safe missing catalog issues')
    .addHelpText('after', ['', 'Examples:', '  heddle memory validate', '  heddle memory validate --repair', ''].join('\n'))
    .action(async (flags: { repair?: boolean }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await MemoryCliV2CommandEdgeService.run('validate', resolved, { repair: Boolean(flags.repair) });
    });

  memoryCommand
    .command('maintain')
    .description('process pending memory candidates into cataloged notes')
    .option('--dry-run', 'show pending candidates without running the maintainer')
    .option('--reconcile', 'repair safe catalog issues before maintenance and report validation after')
    .addHelpText('after', ['', 'Credential sources:', '  heddle auth login openai', '  OPENAI_API_KEY / ANTHROPIC_API_KEY', '', 'Examples:', '  heddle memory maintain --dry-run', '  heddle memory maintain --reconcile', ''].join('\n'))
    .action(async (options: { dryRun?: boolean; reconcile?: boolean }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await MemoryCliV2CommandEdgeService.run('maintain', resolved, {
        dryRun: Boolean(options.dryRun),
        reconcile: Boolean(options.reconcile),
      });
    });

  const authCommand = program
    .command('auth')
    .description('manage provider credentials')
    .action(() => {
      authCommand.outputHelp();
    });

  authCommand
    .command('login <provider>')
    .description('log in to a provider')
    .option('--no-browser', 'print the authorization URL without opening a browser')
    .action(async (provider: string, flags: { browser?: boolean }) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await AuthCliCommandEdgeService.run('login', provider, {
        openBrowser: flags.browser,
        storePath: resolveWorkspaceCredentialStorePath(resolved),
      });
    });

  authCommand
    .command('status')
    .description('show stored provider credentials')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await AuthCliCommandEdgeService.run('status', undefined, {
        storePath: resolveWorkspaceCredentialStorePath(resolved),
      });
    });

  authCommand
    .command('logout <provider>')
    .description('remove a stored provider credential')
    .action(async (provider: string) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await AuthCliCommandEdgeService.run('logout', provider, {
        storePath: resolveWorkspaceCredentialStorePath(resolved),
      });
    });

  program
    .command('eval [args...]')
    .description('run Heddle evaluation harnesses')
    .allowUnknownOption(true)
    .helpOption(false)
    .option('-h, --help', 'display help for command')
    .action(async (...handlerArgs: unknown[]) => {
      const forwardedArgs = resolveCommandEdgeArgs(handlerArgs);
      if (hasHelpArg(forwardedArgs)) {
        await EvalCliV2CommandEdgeService.run(forwardedArgs, {
          repoRoot: resolveHeddleRepoRoot(),
        });
        return;
      }

      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      await EvalCliV2CommandEdgeService.run(forwardedArgs, {
        ...resolved,
        repoRoot: resolveHeddleRepoRoot(),
      });
    });

  program
    .command('heartbeat [args...]')
    .description('manage and run heartbeat tasks')
    .allowUnknownOption(true)
    .helpOption(false)
    .option('-h, --help', 'display help for command')
    .action(async (...handlerArgs: unknown[]) => {
      const forwardedArgs = resolveCommandEdgeArgs(handlerArgs);
      if (hasHelpArg(forwardedArgs)) {
        await HeartbeatCliCommandEdgeService.run(forwardedArgs);
        return;
      }

      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await HeartbeatCliCommandEdgeService.run(forwardedArgs, resolved);
    });

  program
    .command('daemon [args...]')
    .description('start the local Heddle daemon and control plane')
    .allowUnknownOption(true)
    .helpOption(false)
    .option('-h, --help', 'display help for command')
    .action(async (...handlerArgs: unknown[]) => {
      const forwardedArgs = resolveCommandEdgeArgs(handlerArgs);
      if (hasHelpArg(forwardedArgs)) {
        await DaemonCliV2CommandEdgeService.run(forwardedArgs);
        return;
      }

      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await DaemonCliV2CommandEdgeService.run(forwardedArgs, resolved);
    });

  program
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await ChatCliV2CommandEdgeService.run(resolved);
    });

  const argv = process.argv.slice(2);
  const knownCommand = argv[0];
  const removedCommandMessage = knownCommand ? REMOVED_COMMAND_MESSAGES.get(knownCommand) : undefined;
  if (removedCommandMessage) {
    throw new Error(removedCommandMessage);
  }

  if (knownCommand && !isKnownCommand(knownCommand) && !knownCommand.startsWith('-')) {
    const resolved = resolveCliOptions(program.opts<RootCliOptions>());
    chdir(resolved.workspaceRoot);
    await AskCliV2CommandEdgeService.run(argv.join(' ').trim(), {
      workspaceRoot: resolved.workspaceRoot,
      activeWorkspaceId: resolved.activeWorkspaceId,
      model: resolved.model,
      maxSteps: resolved.maxSteps,
      stateDir: resolved.stateDir,
      searchIgnoreDirs: resolved.searchIgnoreDirs,
      systemContext: resolved.systemContext,
      runtimeHost: resolved.runtimeHost,
      forceOwnerConflict: resolved.forceOwnerConflict,
      preferApiKey: resolved.preferApiKey,
    });
    return;
  }

  await program.parseAsync(process.argv);
}

function isKnownCommand(command: string): boolean {
  return KNOWN_COMMANDS.has(command);
}

function resolveCliOptions(flags: RootCliOptions): ResolvedCliOptions {
  const workspaceRoot = resolve(flags.cwd ?? process.cwd());
  const projectConfig = ProjectConfigService.read(workspaceRoot);
  const stateRoot = resolve(workspaceRoot, projectConfig.stateDir ?? '.heddle');
  const workspaceContext = RuntimeWorkspaceService.resolveContext({
    workspaceRoot,
    stateRoot,
  });
  RuntimeDaemonRegistryService.registerKnownWorkspaces({
    registryPath: FileDaemonRegistryRepository.resolvePath(),
    workspaces: workspaceContext.workspaces,
  });
  return {
    workspaceRoot,
    activeWorkspaceId: workspaceContext.activeWorkspaceId,
    model: flags.model ?? projectConfig.model,
    maxSteps: parsePositiveInt(flags.maxSteps) ?? projectConfig.maxSteps,
    preferApiKey: Boolean(flags.preferApiKey),
    stateDir: projectConfig.stateDir ?? '.heddle',
    directShellApproval: projectConfig.directShellApproval ?? 'never',
    searchIgnoreDirs: projectConfig.searchIgnoreDirs ?? [],
    systemContext: CliV2ProjectAgentContextService.load(
      workspaceRoot,
      CliV2ProjectAgentContextService.resolvePaths(workspaceRoot, projectConfig.agentContextPaths)
    ),
    runtimeHost: RuntimeHostResolver.resolveLiveServer(),
    forceOwnerConflict: Boolean(flags.forceOwnerConflict),
  };
}

function resolveWorkspaceCredentialStorePath(options: Pick<ResolvedCliOptions, 'workspaceRoot' | 'stateDir'>): string {
  return ProviderCredentialRepository.resolveStorePath(resolve(options.workspaceRoot, options.stateDir));
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

function resolveCommandEdgeArgs(handlerArgs: unknown[]): string[] {
  const command = handlerArgs.at(-1);
  const rawArgs = Array.isArray(handlerArgs[0]) ? handlerArgs[0] : [];
  if (!(command instanceof Command)) {
    return rawArgs;
  }

  if (rawArgs.some((arg) => arg === '--help' || arg === '-h')) {
    return rawArgs;
  }

  return command.opts<{ help?: boolean }>().help ? [...rawArgs, '--help'] : rawArgs;
}

function hasHelpArg(args: string[]): boolean {
  return args.some((arg) => arg === '--help' || arg === '-h');
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

function resolveAskAgentProfileId(options: { agent?: string; mode?: string }): string | undefined {
  if (options.agent && options.mode) {
    throw new Error('Choose only one of --agent or --mode for heddle ask.');
  }

  if (options.agent) {
    return options.agent;
  }

  if (!options.mode) {
    return undefined;
  }

  const mode = options.mode.trim();
  if (mode === 'ask' || mode === 'code' || mode === 'review') {
    return `builtin:${mode}`;
  }

  throw new Error('Usage: --mode must be one of ask, code, or review.');
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
