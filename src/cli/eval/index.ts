import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  command: 'agent' | 'help';
  casesDir: string;
  caseIds: string[];
  outputDir: string;
  workRoot?: string;
  target: string;
  timeoutMs?: number;
  dryRun: boolean;
};

export async function runEvalCli(rawArgs: string[], options: EvalCliOptions) {
  const args = parseEvalArgs(rawArgs);
  if (args.command === 'help') {
    writeEvalHelp();
    return;
  }

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

export function parseEvalArgs(rawArgs: string[]): EvalArgs {
  const [command = 'help', ...rest] = rawArgs;
  if (command !== 'agent') {
    return {
      command: 'help',
      casesDir: resolve('evals/cases/coding'),
      caseIds: [],
      outputDir: resolve('evals/results', defaultRunDirName('agent')),
      target: 'current',
      dryRun: false,
    };
  }

  const args: EvalArgs = {
    command,
    casesDir: resolve('evals/cases/coding'),
    caseIds: [],
    outputDir: resolve('evals/results', defaultRunDirName('agent')),
    target: 'current',
    dryRun: false,
  };

  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    switch (token) {
      case '--cases-dir':
        args.casesDir = resolve(requireValue(rest, ++index, token));
        break;
      case '--case':
        args.caseIds.push(requireValue(rest, ++index, token));
        break;
      case '--output':
        args.outputDir = resolve(requireValue(rest, ++index, token));
        break;
      case '--work-root':
        args.workRoot = resolve(requireValue(rest, ++index, token));
        break;
      case '--target':
        args.target = requireValue(rest, ++index, token);
        break;
      case '--timeout-ms':
        args.timeoutMs = parsePositiveInt(requireValue(rest, ++index, token), token);
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

function writeEvalHelp() {
  process.stdout.write([
    'Usage: heddle eval agent [options]',
    '',
    'Options:',
    '  --cases-dir <path>   Directory containing JSON eval cases',
    '  --case <id>          Run one case id; repeat to select multiple',
    '  --output <path>      Results directory; defaults to evals/results/agent-YYYY-MM-DD-HHMMSS',
    '  --work-root <path>   Parent directory for disposable workspaces; defaults to <output>/workspaces',
    '  --target <name>      Label for this run, default current',
    '  --timeout-ms <n>     Agent subprocess timeout',
    '  --dry-run            Prepare workspaces and reports without calling the model',
    '',
  ].join('\n'));
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

function defaultRunDirName(prefix: string): string {
  const timestamp = new Date().toISOString()
    .replace('T', '-')
    .replace(/\.\d{3}Z$/, '')
    .replaceAll(':', '');
  return `${prefix}-${timestamp}`;
}
