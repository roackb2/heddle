import { Command } from 'commander';

export type ParsedHeartbeatArgs = {
  command?: string;
  subcommand?: string;
  rest: string[];
  flags: Record<string, string | boolean>;
};

export function parseHeartbeatArgs(args: string[]): ParsedHeartbeatArgs {
  const root = new Command();
  root
    .exitOverride()
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .name('heddle heartbeat')
    .addHelpText('after', ['', 'Duration examples:', '  30s, 15m, 1h, 2d', ''].join('\n'));

  let parsed: ParsedHeartbeatArgs = {
    command: undefined,
    subcommand: undefined,
    rest: [],
    flags: {},
  };

  root
    .command('task [subcommand] [rest...]')
    .allowUnknownOption(true)
    .action((subcommand: string | undefined, rest: string[] = [], command: Command) => {
      parsed = {
        command: 'task',
        subcommand,
        rest,
        flags: collectUnknownFlags(command),
      };
    });

  root
    .command('run [rest...]')
    .allowUnknownOption(true)
    .action((rest: string[] = [], command: Command) => {
      parsed = {
        command: 'run',
        subcommand: undefined,
        rest,
        flags: collectUnknownFlags(command),
      };
    });

  root
    .command('runs [subcommand] [rest...]')
    .allowUnknownOption(true)
    .action((subcommand: string | undefined, rest: string[] = [], command: Command) => {
      parsed = {
        command: 'runs',
        subcommand,
        rest,
        flags: collectUnknownFlags(command),
      };
    });

  root
    .command('start [rest...]')
    .allowUnknownOption(true)
    .action((rest: string[] = [], command: Command) => {
      parsed = {
        command: 'start',
        subcommand: undefined,
        rest,
        flags: collectUnknownFlags(command),
      };
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
