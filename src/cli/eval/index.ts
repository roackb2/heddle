import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanupEvalResults } from '../../core/eval/cleanup.js';
import { loadEvalCases } from '../../core/eval/case-loader.js';
import { runAgentEvalCase } from '../../core/eval/agent-runner.js';
import { writeEvalSuiteReport } from '../../core/eval/report-writer.js';
import type { EvalSuiteReport } from '../../core/eval/schema.js';

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
  timeoutMs?: number;
  before?: Date;
  yes: boolean;
  dryRun: boolean;
};

type EvalCommand = EvalArgs['command'];
type EvalCommandParser = (rawArgs: string[]) => EvalArgs;
type EvalCommandRunner = (args: EvalArgs, options: EvalCliOptions) => Promise<void> | void;

const DEFAULT_CASES_DIR = 'evals/cases/coding/smoke';

const evalCommandParsers: Partial<Record<EvalCommand, EvalCommandParser>> = {
  agent: parseAgentEvalArgs,
  clean: parseCleanEvalArgs,
};

const evalCommandRunners: Partial<Record<EvalCommand, EvalCommandRunner>> = {
  agent: runAgentEval,
  clean: runCleanEval,
  help: () => writeEvalHelp(),
};

export async function runEvalCli(rawArgs: string[], options: EvalCliOptions) {
  const args = parseEvalArgs(rawArgs);
  await evalCommandRunners[args.command]?.(args, options);
}

async function runAgentEval(args: EvalArgs, options: EvalCliOptions) {
  const startedAt = new Date().toISOString();
  const cases = loadEvalCases({
    casesDir: args.casesDir,
    ids: args.caseIds.length ? args.caseIds : undefined,
  });
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
    finishedAt: new Date().toISOString(),
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
  const [command = 'help', ...rest] = rawArgs;
  return evalCommandParsers[command as EvalCommand]?.(rest) ?? defaultEvalArgs('help');
}

function parseAgentEvalArgs(rawArgs: string[]): EvalArgs {
  const args = defaultEvalArgs('agent');

  for (let index = 0; index < rawArgs.length; index++) {
    const token = rawArgs[index];
    switch (token) {
      case '--cases-dir':
        args.casesDir = resolve(requireValue(rawArgs, ++index, token));
        break;
      case '--case':
        args.caseIds.push(requireValue(rawArgs, ++index, token));
        break;
      case '--output':
        args.outputDir = resolve(requireValue(rawArgs, ++index, token));
        break;
      case '--work-root':
        args.workRoot = resolve(requireValue(rawArgs, ++index, token));
        break;
      case '--target':
        args.target = requireValue(rawArgs, ++index, token);
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(rawArgs, ++index, token), token);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown eval option: ${token}`);
    }
  }

  if (!existsSync(args.casesDir)) {
    throw new Error(`Eval cases directory does not exist: ${args.casesDir}`);
  }
  return args;
}

function parseCleanEvalArgs(rawArgs: string[]): EvalArgs {
  const args = defaultEvalArgs('clean');

  for (let index = 0; index < rawArgs.length; index++) {
    const token = rawArgs[index];
    switch (token) {
      case '--results-dir':
        args.resultsDir = resolve(requireValue(rawArgs, ++index, token));
        break;
      case '--before':
        args.before = parseDate(requireValue(rawArgs, ++index, token), token);
        break;
      case '--yes':
        args.yes = true;
        break;
      case '--dry-run':
        args.yes = false;
        break;
      default:
        throw new Error(`Unknown eval clean option: ${token}`);
    }
  }

  return args;
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

function writeEvalHelp() {
  process.stdout.write([
    'Usage:',
    '  heddle eval agent [options]',
    '  heddle eval clean [options]',
    '',
    'Agent options:',
    '  --cases-dir <path>   Directory containing JSON eval cases; defaults to evals/cases/coding/smoke',
    '  --case <id>          Run one case id; repeat to select multiple',
    '  --output <path>      Results directory; defaults to evals/results/agent-YYYY-MM-DD-HHMMSS',
    '  --work-root <path>   Parent directory for disposable workspaces; defaults to <output>/workspaces',
    '  --target <name>      Label for this run, default current',
    '  --timeout-ms <n>     Agent subprocess timeout',
    '  --dry-run            Prepare workspaces and reports without calling the model',
    '',
    'Clean options:',
    '  --results-dir <path> Results directory; defaults to evals/results',
    '  --before <datetime>  Only clean result directories modified before this datetime',
    '  --yes                Actually delete matching result directories',
    '  --dry-run            Preview matching result directories without deleting; default behavior',
    '',
  ].join('\n'));
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

function requireValue(values: string[], index: number, flag: string): string {
  const value = values[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInt(raw: string, flag: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid positive integer for ${flag}: ${raw}`);
  }
  return value;
}

function parseDate(raw: string, flag: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime for ${flag}: ${raw}`);
  }
  return date;
}

function defaultRunDirName(prefix: string): string {
  const timestamp = new Date().toISOString()
    .replace('T', '-')
    .replace(/\.\d{3}Z$/, '')
    .replaceAll(':', '');
  return `${prefix}-${timestamp}`;
}
