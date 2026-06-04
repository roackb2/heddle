import { Command } from 'commander';

export type ParsedHeartbeatArgs = {
  command?: string;
  subcommand?: string;
  rest: string[];
  flags: Record<string, string | boolean>;
};

type HeartbeatCommandBuilder = (args: ParsedHeartbeatArgs) => void;

export function buildHeartbeatCommand(onParsed: HeartbeatCommandBuilder = () => undefined): Command {
  const root = new Command();
  root
    .exitOverride()
    .name('heddle heartbeat')
    .description('Manage and run heartbeat tasks')
    .addHelpText('after', ['', 'Duration examples:', '  30s, 15m, 1h, 2d', ''].join('\n'))
    .action(() => onParsed({
      command: 'help',
      subcommand: undefined,
      rest: [],
      flags: {},
    }));

  const task = root
    .command('task')
    .description('manage heartbeat tasks')
    .addHelpText('after', [
      '',
      'Examples:',
      '  heddle heartbeat task list',
      '  heddle heartbeat task show repo-gardener',
      '  heddle heartbeat task add --id repo-gardener --task "Maintain the repo" --every 30m',
      '',
    ].join('\n'))
    .action(() => onParsed({
      command: 'task',
      subcommand: undefined,
      rest: [],
      flags: {},
    }));

  task
    .command('add [rest...]')
    .description('create a heartbeat task')
    .option('--id <id>', 'task id')
    .option('--task <text>', 'task prompt text')
    .option('--goal <text>', 'alias for --task')
    .option('--name <name>', 'optional display name')
    .option('--every <duration>', 'schedule interval')
    .option('--interval <duration>', 'alias for --every')
    .option('--continuation <mode>', 'continuation mode: operator or agent')
    .option('--model <name>', 'override model')
    .option('--max-steps <n>', 'override step limit')
    .option('--disabled', 'create the task disabled')
    .option('--defer', 'skip the immediate first run')
    .addHelpText('after', [
      '',
      'Examples:',
      '  heddle heartbeat task add --id repo-gardener --task "Maintain the repo" --every 30m',
      '',
    ].join('\n'))
    .action((rest: string[], flags: HeartbeatTaskAddFlags) => onParsed({
      command: 'task',
      subcommand: 'add',
      rest,
      flags: {
        ...stringFlags(flags, ['id', 'task', 'goal', 'name', 'every', 'interval', 'continuation', 'model', 'maxSteps']),
        ...booleanFlags(flags, ['disabled', 'defer']),
      },
    }));

  task
    .command('list')
    .description('list heartbeat tasks')
    .action(() => onParsed({
      command: 'task',
      subcommand: 'list',
      rest: [],
      flags: {},
    }));

  task
    .command('show [rest...]')
    .description('show one heartbeat task')
    .option('--id <id>', 'task id')
    .action((rest: string[], flags: HeartbeatTaskIdFlags) => onParsed({
      command: 'task',
      subcommand: 'show',
      rest,
      flags: stringFlags(flags, ['id']),
    }));

  task
    .command('enable [rest...]')
    .description('enable a heartbeat task')
    .option('--id <id>', 'task id')
    .action((rest: string[], flags: HeartbeatTaskIdFlags) => onParsed({
      command: 'task',
      subcommand: 'enable',
      rest,
      flags: stringFlags(flags, ['id']),
    }));

  task
    .command('disable [rest...]')
    .description('disable a heartbeat task')
    .option('--id <id>', 'task id')
    .action((rest: string[], flags: HeartbeatTaskIdFlags) => onParsed({
      command: 'task',
      subcommand: 'disable',
      rest,
      flags: stringFlags(flags, ['id']),
    }));

  root
    .command('run [rest...]')
    .description('ask the server to run due tasks or one task now')
    .option('--task <id>', 'run one heartbeat task immediately')
    .option('--model <name>', 'override model')
    .option('--max-steps <n>', 'override step limit')
    .addHelpText('after', [
      '',
      'Examples:',
      '  heddle heartbeat run',
      '  heddle heartbeat run repo-gardener',
      '  heddle heartbeat run --task repo-gardener --model gpt-5.1-codex',
      '',
    ].join('\n'))
    .action((rest: string[], flags: HeartbeatRunFlags) => onParsed({
      command: 'run',
      subcommand: undefined,
      rest,
      flags: stringFlags(flags, ['task', 'model', 'maxSteps']),
    }));

  const runs = root
    .command('runs')
    .description('inspect heartbeat run records')
    .addHelpText('after', [
      '',
      'Examples:',
      '  heddle heartbeat runs list --task repo-gardener',
      '  heddle heartbeat runs show latest',
      '',
    ].join('\n'))
    .action(() => onParsed({
      command: 'runs',
      subcommand: undefined,
      rest: [],
      flags: {},
    }));

  runs
    .command('list [rest...]')
    .description('list heartbeat run records')
    .option('--task <id>', 'filter by heartbeat task id')
    .option('--limit <n>', 'maximum runs to print')
    .action((rest: string[], flags: HeartbeatRunsListFlags) => onParsed({
      command: 'runs',
      subcommand: 'list',
      rest,
      flags: stringFlags(flags, ['task', 'limit']),
    }));

  runs
    .command('show [rest...]')
    .description('show one heartbeat run')
    .option('--task <id>', 'filter by heartbeat task id')
    .option('--id <id>', 'run id')
    .action((rest: string[], flags: HeartbeatRunsShowFlags) => onParsed({
      command: 'runs',
      subcommand: 'show',
      rest,
      flags: stringFlags(flags, ['task', 'id']),
    }));

  root
    .command('start [rest...]')
    .description('create or update a task and keep the server-backed scheduler running')
    .option('--id <id>', 'task id')
    .option('--task <text>', 'task prompt text')
    .option('--goal <text>', 'alias for --task')
    .option('--name <name>', 'optional display name')
    .option('--every <duration>', 'schedule interval')
    .option('--interval <duration>', 'alias for --every')
    .option('--poll <duration>', 'embedded scheduler poll interval')
    .option('--model <name>', 'override model')
    .option('--max-steps <n>', 'override step limit')
    .option('--defer', 'skip the immediate first run')
    .option('--once', 'save the task and run it once immediately')
    .addHelpText('after', [
      '',
      'Examples:',
      '  heddle heartbeat start repo-gardener --task "Maintain the repo" --every 30m',
      '  heddle heartbeat start --once --task "Check the repo"',
      '',
    ].join('\n'))
    .action((rest: string[], flags: HeartbeatStartFlags) => onParsed({
      command: 'start',
      subcommand: rest[0],
      rest: rest.slice(1),
      flags: {
        ...stringFlags(flags, ['id', 'task', 'goal', 'name', 'every', 'interval', 'poll', 'model', 'maxSteps']),
        ...booleanFlags(flags, ['defer', 'once']),
      },
    }));

  return root;
}

export function parseHeartbeatArgs(args: string[]): ParsedHeartbeatArgs {
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return {
      command: 'help',
      subcommand: undefined,
      rest: [],
      flags: {},
    };
  }

  let parsed: ParsedHeartbeatArgs | undefined;
  buildHeartbeatCommand((args) => {
    parsed = args;
  }).parse(args, { from: 'user' });
  return parsed ?? {
    command: 'help',
    subcommand: undefined,
    rest: [],
    flags: {},
  };
}

export function renderHeartbeatHelp(args: string[]): string {
  const root = buildHeartbeatCommand();
  return resolveHelpCommand(root, normalizeHelpArgs(args)).helpInformation().trimEnd();
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

function normalizeHelpArgs(args: string[]): string[] {
  if (!args.length) {
    return [];
  }

  if (args[0] !== 'help') {
    return args;
  }

  return args.slice(1);
}

function resolveHelpCommand(root: Command, args: string[]): Command {
  let command = root;
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      continue;
    }

    if (arg.startsWith('--')) {
      if (!arg.includes('=')) {
        skipNext = true;
      }
      continue;
    }

    const nextCommand = command.commands.find((candidate) => candidate.name() === arg);
    if (!nextCommand) {
      break;
    }
    command = nextCommand;
  }

  return command;
}

type HeartbeatTaskAddFlags = {
  id?: string;
  task?: string;
  goal?: string;
  name?: string;
  every?: string;
  interval?: string;
  continuation?: string;
  model?: string;
  maxSteps?: string;
  disabled?: boolean;
  defer?: boolean;
};

type HeartbeatTaskIdFlags = {
  id?: string;
};

type HeartbeatRunFlags = {
  task?: string;
  model?: string;
  maxSteps?: string;
};

type HeartbeatRunsListFlags = {
  task?: string;
  limit?: string;
};

type HeartbeatRunsShowFlags = {
  task?: string;
  id?: string;
};

type HeartbeatStartFlags = {
  id?: string;
  task?: string;
  goal?: string;
  name?: string;
  every?: string;
  interval?: string;
  poll?: string;
  model?: string;
  maxSteps?: string;
  defer?: boolean;
  once?: boolean;
};

function stringFlags(
  flags: Record<string, unknown>,
  names: string[],
): Record<string, string> {
  return Object.fromEntries(
    names
      .map((name) => [toKebabFlagName(name), flags[name]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function booleanFlags(
  flags: Record<string, unknown>,
  names: string[],
): Record<string, boolean> {
  return Object.fromEntries(
    names
      .map((name) => [toKebabFlagName(name), flags[name]])
      .filter((entry): entry is [string, boolean] => entry[1] === true)
  );
}

function toKebabFlagName(name: string): string {
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
