import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import dayjs from 'dayjs';
import { cleanupEvalResults } from '@/core/eval/cleanup.js';
import { loadEvalCases } from '@/core/eval/case-loader.js';
import { runAgentEvalCase } from '@/core/eval/agent-runner.js';
import { writeEvalSuiteReport } from '@/core/eval/report-writer.js';
import type { EvalCase, EvalSuiteReport } from '@/core/eval/schema.js';

export type EvalCliOptions = {
  repoRoot: string;
  model?: string;
  maxSteps?: number;
  preferApiKey?: boolean;
};

type EvalArgs = {
  command: 'agent' | 'clean' | 'help';
  casesDir: string;
  caseIds: string[];
  outputDir: string;
  resultsDir: string;
  workRoot?: string;
  target: string;
  fixtureRef?: string;
  timeoutMs?: number;
  before?: Date;
  helpText?: string;
  yes: boolean;
  dryRun: boolean;
};

type EvalCommand = EvalArgs['command'];
type EvalCommandRunner = (args: EvalArgs, options: EvalCliOptions) => Promise<void> | void;

const DEFAULT_CASES_DIR = 'evals/cases/coding/smoke';

const evalCommandRunners: Partial<Record<EvalCommand, EvalCommandRunner>> = {
  agent: runAgentEval,
  clean: runCleanEval,
  help: (args) => {
    process.stdout.write(`${args.helpText ?? renderEvalHelp([])}\n`);
  },
};

/**
 * Command edge for `heddle eval`.
 *
 * Owns: terminal eval argument parsing, command dispatch, progress/report
 * output, and dev-harness defaults.
 *
 * Does not own: eval case schemas, workspace fixture setup, agent subprocess
 * execution, cleanup selection semantics, or report generation. Those stay in
 * `src/core/eval` public harness services.
 */
export class EvalCliV2CommandEdgeService {
  static async run(rawArgs: string[], options: EvalCliOptions): Promise<void> {
    const args = parseEvalArgs(rawArgs);
    await evalCommandRunners[args.command]?.(args, options);
  }
}

async function runAgentEval(args: EvalArgs, options: EvalCliOptions) {
  const startedAt = dayjs().toISOString();
  const loadedCases = loadEvalCases({
    casesDir: args.casesDir,
    ids: args.caseIds.length ? args.caseIds : undefined,
  });
  const cases = loadedCases.map((testCase) => overrideFixtureRef(testCase, args.fixtureRef));
  if (cases.length === 0) {
    throw new Error(`No eval cases found under ${args.casesDir}`);
  }

  mkdirSync(args.outputDir, { recursive: true });
  const workRoot = args.workRoot ?? join(args.outputDir, 'workspaces');
  mkdirSync(workRoot, { recursive: true });

  const results = [];
  for (const testCase of cases) {
    process.stdout.write(`Running eval case ${testCase.id}...\n`);
    const result = await runAgentEvalCase({
      testCase,
      repoRoot: options.repoRoot,
      resultsRoot: args.outputDir,
      workRoot,
      target: args.target,
      model: options.model,
      maxSteps: options.maxSteps,
      preferApiKey: options.preferApiKey,
      timeoutMs: args.timeoutMs,
      dryRun: args.dryRun,
    });
    results.push(result);
    process.stdout.write(`- ${result.status}: ${testCase.id}\n`);
  }

  const report: EvalSuiteReport = {
    version: 1,
    target: args.target,
    repoRoot: options.repoRoot,
    startedAt,
    finishedAt: dayjs().toISOString(),
    resultsDir: args.outputDir,
    results,
  };
  const saved = writeEvalSuiteReport(report);
  process.stdout.write(`Eval report: ${saved.markdownPath}\n`);
  process.stdout.write(`Eval JSON: ${saved.jsonPath}\n`);
}

function runCleanEval(args: EvalArgs) {
  const result = cleanupEvalResults({
    resultsDir: args.resultsDir,
    before: args.before,
    dryRun: !args.yes,
  });
  writeCleanupResult(result);
}

export function parseEvalArgs(rawArgs: string[]): EvalArgs {
  const commandName = rawArgs[0];
  if (rawArgs.length === 0 || hasHelpFlag(rawArgs) || !isEvalSubcommand(commandName)) {
    return {
      ...defaultEvalArgs('help'),
      helpText: renderEvalHelp(rawArgs),
    };
  }

  let parsed: EvalArgs | undefined;
  const root = buildEvalCommand((args) => {
    parsed = args;
  });

  try {
    root.parse(rawArgs, { from: 'user' });
  } catch (error) {
    if (isUnknownCommandError(error)) {
      return {
        ...defaultEvalArgs('help'),
        helpText: renderEvalHelp([]),
      };
    }
    throw error;
  }

  if (!parsed) {
    return {
      ...defaultEvalArgs('help'),
      helpText: renderEvalHelp(rawArgs),
    };
  }

  return parsed;
}

type EvalCommandBuilder = (args: EvalArgs) => void;

function buildEvalCommand(onParsed: EvalCommandBuilder): Command {
  const root = new Command();
  root
    .name('heddle eval')
    .description('Run Heddle evaluation harnesses')
    .exitOverride()
    .showHelpAfterError()
    .addHelpCommand('help [command]', 'display help for command')
    .action(() => onParsed({
      ...defaultEvalArgs('help'),
      helpText: root.helpInformation().trimEnd(),
    }));

  root
    .command('agent')
    .description('run JSON-defined agent eval cases')
    .option('--cases-dir <path>', 'directory containing JSON eval cases', DEFAULT_CASES_DIR)
    .option('--case <id>', 'run one case id; repeat to select multiple', collectOption, [])
    .option('--output <path>', 'results directory')
    .option('--work-root <path>', 'parent directory for disposable workspaces')
    .option('--target <name>', 'label for this run', 'current')
    .option('--fixture-ref <ref>', 'override git-worktree fixture ref for target workspace code')
    .option('--timeout-ms <n>', 'agent subprocess timeout', (value) => parsePositiveInt(value, '--timeout-ms'))
    .option('--dry-run', 'prepare workspaces and reports without calling the model')
    .action((flags: AgentEvalCommandFlags) => {
      const args = {
        ...defaultEvalArgs('agent'),
        casesDir: resolve(flags.casesDir),
        caseIds: flags.case,
        outputDir: resolve(flags.output ?? join('evals/results', defaultRunDirName('agent'))),
        workRoot: flags.workRoot ? resolve(flags.workRoot) : undefined,
        target: flags.target,
        fixtureRef: flags.fixtureRef,
        timeoutMs: flags.timeoutMs,
        dryRun: Boolean(flags.dryRun),
      };
      if (!existsSync(args.casesDir)) {
        throw new Error(`Eval cases directory does not exist: ${args.casesDir}`);
      }
      onParsed(args);
    });

  root
    .command('clean')
    .description('prune generated eval result directories')
    .option('--results-dir <path>', 'results directory', 'evals/results')
    .option('--before <datetime>', 'only clean result directories modified before this datetime', (value) => parseDate(value, '--before'))
    .option('--yes', 'actually delete matching result directories')
    .option('--dry-run', 'preview matching result directories without deleting')
    .action((flags: CleanEvalCommandFlags) => {
      onParsed({
        ...defaultEvalArgs('clean'),
        resultsDir: resolve(flags.resultsDir),
        before: flags.before,
        yes: Boolean(flags.yes) && !flags.dryRun,
        dryRun: Boolean(flags.dryRun),
      });
    });

  return root;
}

type AgentEvalCommandFlags = {
  casesDir: string;
  case: string[];
  output?: string;
  workRoot?: string;
  target: string;
  fixtureRef?: string;
  timeoutMs?: number;
  dryRun?: boolean;
};

type CleanEvalCommandFlags = {
  resultsDir: string;
  before?: Date;
  yes?: boolean;
  dryRun?: boolean;
};

export function renderEvalHelp(rawArgs: string[]): string {
  const root = buildEvalCommand(() => {});
  return resolveHelpCommand(root, normalizeHelpArgs(rawArgs)).helpInformation().trimEnd();
}

function defaultEvalArgs(command: EvalCommand): EvalArgs {
  return {
    command,
    casesDir: resolve(DEFAULT_CASES_DIR),
    caseIds: [],
    outputDir: resolve('evals/results', defaultRunDirName('agent')),
    resultsDir: resolve('evals/results'),
    target: 'current',
    yes: false,
    dryRun: false,
  };
}

function overrideFixtureRef(
  testCase: EvalCase,
  fixtureRef: string | undefined,
): EvalCase {
  if (!fixtureRef || testCase.fixture.type !== 'git-worktree') {
    return testCase;
  }
  return {
    ...testCase,
    fixture: {
      ...testCase.fixture,
      ref: fixtureRef,
    },
  };
}

function writeCleanupResult(result: ReturnType<typeof cleanupEvalResults>) {
  process.stdout.write(`Eval results dir: ${result.resultsDir}\n`);
  process.stdout.write(`Mode: ${result.dryRun ? 'dry-run' : 'delete'}\n`);
  if (result.before) {
    process.stdout.write(`Before: ${result.before}\n`);
  }
  process.stdout.write(`Matched: ${result.candidates.length}\n`);
  if (result.candidates.length > 0) {
    for (const candidate of result.candidates) {
      process.stdout.write(`- ${candidate.name} (${candidate.modifiedAt})\n`);
    }
  }
  if (result.dryRun) {
    process.stdout.write('No files deleted. Pass --yes to delete matched result directories.\n');
    return;
  }
  process.stdout.write(`Deleted: ${result.removed.length}\n`);
}

function parsePositiveInt(raw: string, flag: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid positive integer for ${flag}: ${raw}`);
  }
  return value;
}

function parseDate(raw: string, flag: string): Date {
  const date = dayjs(raw);
  if (!date.isValid()) {
    throw new Error(`Invalid datetime for ${flag}: ${raw}`);
  }
  return date.toDate();
}

function defaultRunDirName(prefix: string): string {
  return `${prefix}-${dayjs().format('YYYY-MM-DD-HHmmss')}`;
}

function hasHelpFlag(rawArgs: string[]): boolean {
  return rawArgs.some((arg) => arg === '--help' || arg === '-h');
}

function isEvalSubcommand(commandName: string | undefined): commandName is 'agent' | 'clean' {
  return commandName === 'agent' || commandName === 'clean';
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizeHelpArgs(rawArgs: string[]): string[] {
  const args = rawArgs.filter((arg) => arg !== '--help' && arg !== '-h');
  return args[0] === 'help' ? args.slice(1) : args;
}

function resolveHelpCommand(root: Command, args: string[]): Command {
  let current = root;
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token.startsWith('-')) {
      if (!token.includes('=')) {
        index++;
      }
      continue;
    }

    const child = current.commands.find((command) => command.name() === token || command.aliases().includes(token));
    if (!child) {
      break;
    }
    current = child;
  }
  return current;
}

function isUnknownCommandError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('error: unknown command');
}
