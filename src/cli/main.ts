#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chdir } from 'node:process';
import { Command } from 'commander';
import { runAskCli } from './ask.js';
import { startChatCli } from './chat/index.js';
import { runDaemonCli } from './daemon.js';
import { runHeartbeatCli } from './heartbeat.js';
import { runSessionCli } from './session.js';

type RootCliOptions = {
  cwd?: string;
  model?: string;
  maxSteps?: string;
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
  stateDir: string;
  directShellApproval: 'always' | 'never';
  searchIgnoreDirs: string[];
  systemContext?: string;
};

const DEFAULT_MODEL_FOR_CONFIG = 'gpt-5.1-codex';
const CLI_VERSION = readCliVersion();

async function main() {
  const program = new Command();
  program
    .name('heddle')
    .description('Heddle CLI')
    .version(CLI_VERSION, '--version', 'print the installed Heddle version')
    .option('--cwd <path>', 'run against another workspace root')
    .option('--model <name>', 'choose the active model')
    .option('--max-steps <n>', 'limit the agent loop length');

  program
    .command('chat')
    .description('start the interactive chat UI')
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      startChatCli(resolved);
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
        ...resolved,
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

  program
    .command('heartbeat [args...]')
    .description('manage and run heartbeat tasks')
    .allowUnknownOption(true)
    .action(async (args: string[]) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await runHeartbeatCli(args ?? [], resolved);
    });

  program
    .command('daemon [args...]')
    .description('start the local Heddle daemon and control plane')
    .allowUnknownOption(true)
    .action(async (args: string[]) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await runDaemonCli(args ?? [], resolved);
    });

  program
    .command('session [args...]')
    .description('manage local chat session storage')
    .allowUnknownOption(true)
    .action(async (args: string[]) => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      await runSessionCli(args ?? [], resolved);
    });

  program
    .action(async () => {
      const resolved = resolveCliOptions(program.opts<RootCliOptions>());
      chdir(resolved.workspaceRoot);
      startChatCli(resolved);
    });

  const argv = process.argv.slice(2);
  const knownCommand = argv[0];
  if (knownCommand && !isKnownCommand(knownCommand) && !knownCommand.startsWith('-')) {
    const resolved = resolveCliOptions(program.opts<RootCliOptions>());
    chdir(resolved.workspaceRoot);
    await runAskCli(argv.join(' ').trim(), resolved);
    return;
  }

  await program.parseAsync(process.argv);
}

function isKnownCommand(command: string): boolean {
  return ['chat', 'ask', 'init', 'heartbeat', 'daemon', 'session', 'help'].includes(command);
}

function resolveCliOptions(flags: RootCliOptions): ResolvedCliOptions {
  const workspaceRoot = resolve(flags.cwd ?? process.cwd());
  const projectConfig = loadProjectConfig(workspaceRoot);
  return {
    workspaceRoot,
    model: flags.model ?? projectConfig.model,
    maxSteps: parsePositiveInt(flags.maxSteps) ?? projectConfig.maxSteps,
    stateDir: projectConfig.stateDir ?? '.heddle',
    directShellApproval: projectConfig.directShellApproval ?? 'never',
    searchIgnoreDirs: projectConfig.searchIgnoreDirs ?? [],
    systemContext: loadProjectAgentContext(workspaceRoot, projectConfig.agentContextPaths ?? ['AGENTS.md']),
  };
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
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
