import { Command } from 'commander';

export type ParsedHeartbeatArgs = {
  command?: string;
  subcommand?: string;
  rest: string[];
  flags: Record<string, string | boolean>;
};

export function buildHeartbeatCommand(onParsed?: (parsed: ParsedHeartbeatArgs) => void): Command {
  const root = new Command();
  root
    .exitOverride()
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .name('heddle heartbeat')
    .description('Manage and run heartbeat tasks')
    .addHelpText('after', ['', 'Duration examples:', '  30s, 15m, 1h, 2d', ''].join('\n'));

  root
    .command('task [subcommand] [rest...]')
    .description('manage heartbeat tasks')
    .allowUnknownOption(true)
    .action((subcommand: string | undefined, rest: string[] = [], command: Command) => {
      onParsed?.({
        command: 'task',
        subcommand,
        rest,
        flags: collectUnknownFlags(command),
      });
    });

  root
    .command('run [rest...]')
    .description('ask the server to run due tasks or one task now')
    .allowUnknownOption(true)
    .action((rest: string[] = [], command: Command) => {
      onParsed?.({
        command: 'run',
        subcommand: undefined,
        rest,
        flags: collectUnknownFlags(command),
      });
    });

  root
    .command('runs [subcommand] [rest...]')
    .description('inspect heartbeat run records')
    .allowUnknownOption(true)
    .action((subcommand: string | undefined, rest: string[] = [], command: Command) => {
      onParsed?.({
        command: 'runs',
        subcommand,
        rest,
        flags: collectUnknownFlags(command),
      });
    });

  root
    .command('start [rest...]')
    .description('create or update a task and keep the server-backed scheduler running')
    .allowUnknownOption(true)
    .action((rest: string[] = [], command: Command) => {
      onParsed?.({
        command: 'start',
        subcommand: undefined,
        rest,
        flags: collectUnknownFlags(command),
      });
    });

  return root;
}

export function parseHeartbeatArgs(args: string[]): ParsedHeartbeatArgs {
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return {
      command: args[0] ?? 'help',
      subcommand: undefined,
      rest: args.slice(1),
      flags: {},
    };
  }

  let parsed: ParsedHeartbeatArgs = {
    command: undefined,
    subcommand: undefined,
    rest: [],
    flags: {},
  };
  const root = buildHeartbeatCommand((next) => {
    parsed = next;
  });

  try {
    root.parse(['node', 'heddle-heartbeat', ...args], { from: 'node' });
  } catch {
    return fallbackParseHeartbeatArgs(args);
  }

  if (!parsed.command) {
    return fallbackParseHeartbeatArgs(args);
  }

  return parsed;
}

export function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function booleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}

export function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function collectUnknownFlags(command: Command): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  const unknown = command.parseOptions(command.args).unknown;

  for (let index = 0; index < unknown.length; index++) {
    const arg = unknown[index] ?? '';
    if (!arg.startsWith('--')) {
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const name = arg.slice(2);
    const next = unknown[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index++;
  }

  return flags;
}

function fallbackParseHeartbeatArgs(args: string[]): ParsedHeartbeatArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex > 0) {
      flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }

    flags[name] = next;
    index++;
  }

  return {
    command: positionals[0],
    subcommand: positionals[1],
    rest: positionals.slice(2),
    flags,
  };
}
