#!/usr/bin/env node

import { chdir } from 'node:process';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { startChatCli } from './chat/index.js';
import { runAskCli } from './ask.js';
import { runHeartbeatCli } from './heartbeat.js';

type CliFlags = {
  cwd?: string;
  model?: string;
  maxSteps?: number;
};

type HeddleProjectConfig = {
  model?: string;
  maxSteps?: number;
  stateDir?: string;
  directShellApproval?: 'always' | 'never';
  searchIgnoreDirs?: string[];
  agentContextPaths?: string[];
};

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  const workspaceRoot = resolve(parsed.flags.cwd ?? process.cwd());
  const projectConfig = loadProjectConfig(workspaceRoot);
  const resolved = {
    workspaceRoot,
    model: parsed.flags.model ?? projectConfig.model,
    maxSteps: parsed.flags.maxSteps ?? projectConfig.maxSteps,
    stateDir: projectConfig.stateDir ?? '.heddle',
    directShellApproval: projectConfig.directShellApproval ?? 'never',
    searchIgnoreDirs: projectConfig.searchIgnoreDirs ?? [],
    systemContext: loadProjectAgentContext(workspaceRoot, projectConfig.agentContextPaths ?? ['AGENTS.md']),
  };

  chdir(workspaceRoot);

  if (!parsed.command || parsed.command === 'chat') {
    startChatCli(resolved);
    return;
  }

  if (parsed.command === 'ask') {
    await runAskCli(parsed.rest.join(' ').trim(), resolved);
    return;
  }

  if (parsed.command === 'init') {
    initializeProjectConfig(workspaceRoot);
    return;
  }

  if (parsed.command === 'heartbeat') {
    await runHeartbeatCli(parsed.rest, resolved);
    return;
  }

  if (parsed.command === '--help' || parsed.command === '-h' || parsed.command === 'help') {
    printHelp();
    return;
  }

  await runAskCli([parsed.command, ...parsed.rest].join(' ').trim(), resolved);
}

function parseCli(args: string[]): { command?: string; rest: string[]; flags: CliFlags } {
  const flags: CliFlags = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg === '--cwd') {
      flags.cwd = args[index + 1];
      index++;
      continue;
    }
    if (arg.startsWith('--cwd=')) {
      flags.cwd = arg.slice('--cwd='.length);
      continue;
    }
    if (arg === '--model') {
      flags.model = args[index + 1];
      index++;
      continue;
    }
    if (arg.startsWith('--model=')) {
      flags.model = arg.slice('--model='.length);
      continue;
    }
    if (arg === '--max-steps') {
      flags.maxSteps = parsePositiveInt(args[index + 1]);
      index++;
      continue;
    }
    if (arg.startsWith('--max-steps=')) {
      flags.maxSteps = parsePositiveInt(arg.slice('--max-steps='.length));
      continue;
    }

    positionals.push(arg);
  }

  return {
    command: positionals[0],
    rest: positionals.slice(1),
    flags,
  };
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

function printHelp() {
  process.stdout.write(
    [
      'Heddle',
      '',
      'Usage:',
      '  heddle [--cwd <path>] [--model <name>] [--max-steps <n>]',
      '  heddle chat [--cwd <path>] [--model <name>] [--max-steps <n>]',
      '  heddle ask "<goal>" [--cwd <path>] [--model <name>] [--max-steps <n>]',
      '  heddle heartbeat task add --id <id> --task "<durable task>" [--every 15m]',
      '  heddle heartbeat task list',
      '  heddle heartbeat task show <id>',
      '  heddle heartbeat task enable <id>',
      '  heddle heartbeat task disable <id>',
      '  heddle heartbeat start [--every 30m] [--task "<durable task>"] [--model <name>]',
      '  heddle heartbeat run --once',
      '  heddle heartbeat run [--poll 60s]',
      '  heddle init [--cwd <path>]',
      '',
      'Project config:',
      '  heddle.config.json in the target workspace root',
      '  { "model": "gpt-5.1-codex", "maxSteps": 40, "stateDir": ".heddle", "directShellApproval": "never", "searchIgnoreDirs": [".git", "dist", "node_modules", ".heddle"], "agentContextPaths": ["AGENTS.md"] }',
      '',
      'Environment:',
      '  OPENAI_API_KEY or ANTHROPIC_API_KEY',
      '  Dev fallback conventions also supported: PERSONAL_OPENAI_API_KEY, PERSONAL_ANTHROPIC_API_KEY',
      '',
    ].join('\n'),
  );
}

function initializeProjectConfig(workspaceRoot: string) {
  const configPath = resolve(workspaceRoot, 'heddle.config.json');
  if (existsSync(configPath)) {
    process.stdout.write(`heddle.config.json already exists at ${configPath}\n`);
    return;
  }

  const template = {
    model: DEFAULT_MODEL_FOR_CONFIG,
    maxSteps: 40,
    stateDir: '.heddle',
    directShellApproval: 'never',
    searchIgnoreDirs: ['.git', 'dist', 'node_modules', '.heddle'],
    agentContextPaths: ['AGENTS.md'],
  };
  writeFileSync(configPath, `${JSON.stringify(template, null, 2)}\n`);
  process.stdout.write(`Created ${configPath}\n`);
}

const DEFAULT_MODEL_FOR_CONFIG = 'gpt-5.1-codex';

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
