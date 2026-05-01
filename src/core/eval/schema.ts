import { z } from 'zod';

export const evalCheckSchema = z.object({
  name: z.string().trim().min(1)
    .describe('Human-readable label for this check in reports. Defaults to the command when omitted.')
    .optional(),
  command: z.string().trim().min(1)
    .describe('Shell command to run inside the disposable eval workspace after the agent finishes. Exit code 0 means the check passed.'),
  timeoutMs: z.number().int().positive()
    .describe('Optional timeout for this check command in milliseconds.')
    .optional(),
}).describe('A deterministic post-run command used to decide whether the agent-produced workspace passes objective validation.');

export const evalSetupSchema = z.object({
  files: z.record(
    z.string().trim().min(1).describe('Workspace-relative file path to create before the eval starts.'),
    z.string().describe('Exact UTF-8 file contents to write for the fixture file.'),
  )
    .describe('Fixture files to write into the disposable workspace before committing the initial Git baseline.')
    .optional(),
  commands: z.array(evalCheckSchema)
    .describe('Setup commands to run after fixture files are written and before the initial Git baseline is committed.')
    .optional(),
  commitMessage: z.string().trim().min(1)
    .describe('Commit message for the initial fixture Git baseline. Defaults to a generated eval fixture message.')
    .optional(),
}).describe('Instructions for creating the disposable repository state that the agent will work against.');

export const evalInlineFixtureSchema = z.object({
  type: z.literal('inline')
    .describe('Create a small disposable Git repository from the case setup files and commands.'),
}).describe('A synthetic disposable repository built from inline eval setup data.');

export const evalGitWorktreeFixtureSchema = z.object({
  type: z.literal('git-worktree')
    .describe('Create a disposable Git worktree from an existing repository at a pinned ref.'),
  repo: z.string().trim().min(1)
    .describe('Repository path to create the worktree from. Relative paths are resolved from the Heddle repo root.')
    .default('.'),
  ref: z.string().trim().min(1)
    .describe('Pinned target ref for the worktree, such as a release tag or commit SHA. Avoid moving HEAD for comparable evals.'),
}).describe('A realistic disposable repository fixture created from a pinned Git ref.');

export const evalFixtureSchema = z.discriminatedUnion('type', [
  evalInlineFixtureSchema,
  evalGitWorktreeFixtureSchema,
]).describe('How to prepare the disposable workspace the agent edits.');

export const agentEvalCaseSchema = z.object({
  id: z.string().trim().regex(/^[a-zA-Z0-9._-]+$/, 'Use a filesystem-safe case id.')
    .describe('Stable filesystem-safe case id used in result paths, filtering, and reports.'),
  kind: z.literal('coding')
    .describe('Eval case type. The first harness slice supports coding cases run through ask --new-session.'),
  description: z.string().trim()
    .describe('Optional short explanation of what behavior this case is meant to exercise.')
    .optional(),
  prompt: z.string().trim().min(1)
    .describe('User prompt sent to Heddle in the disposable workspace. This should ask for real coding work, not just Q&A.'),
  model: z.string().trim().min(1)
    .describe('Optional model override for this case. The CLI-level --model takes precedence when supplied.')
    .optional(),
  maxSteps: z.number().int().positive()
    .describe('Optional maximum agent loop steps for this case. The CLI-level --max-steps takes precedence when supplied.')
    .optional(),
  setup: evalSetupSchema
    .describe('Disposable workspace setup for this case.')
    .default({}),
  fixture: evalFixtureSchema
    .describe('Workspace fixture source. Defaults to an inline synthetic repository.')
    .default({ type: 'inline' }),
  checks: z.array(evalCheckSchema)
    .describe('Deterministic post-agent commands that must pass for the case to be marked passed.')
    .default([]),
  rubric: z.array(
    z.string().trim().min(1).describe('Qualitative behavior criterion for human or future LLM judging.'),
  )
    .describe('Non-deterministic quality criteria preserved in reports for manual or future judge review.')
    .default([]),
  tags: z.array(
    z.string().trim().min(1).describe('Free-form label for filtering or grouping eval cases.'),
  )
    .describe('Case labels such as bugfix, refactor, verification, multi-file, or tui.')
    .default([]),
}).describe('A live coding-task eval case run in a disposable Git workspace through Heddle ask/session execution.');

export const evalCaseSchema = agentEvalCaseSchema;

export type EvalCheck = z.infer<typeof evalCheckSchema>;
export type EvalSetup = z.infer<typeof evalSetupSchema>;
export type EvalFixture = z.infer<typeof evalFixtureSchema>;
export type AgentEvalCase = z.infer<typeof agentEvalCaseSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;

export type EvalCheckResult = {
  name: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
  timedOut: boolean;
};

export type EvalTraceMetrics = {
  assistantTurns: number;
  toolCalls: number;
  toolResults: number;
  mutations: number;
  approvalsRequested: number;
  approvalsResolved: number;
  toolErrors: number;
  verificationCommandsAfterMutation: number;
  firstMutationStep?: number;
  outcome?: string;
  summary?: string;
  toolsByName: Record<string, number>;
  readOrSearchBeforeMutation: string[];
};

export type EvalRunResult = {
  caseId: string;
  target: string;
  status: 'passed' | 'failed';
  workspaceRoot: string;
  outputDir: string;
  fixture: {
    type: EvalFixture['type'];
    repo?: string;
    ref?: string;
    resolvedRef?: string;
    baselineCommit?: string;
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  agent: {
    command: string[];
    exitCode: number | null;
    stdoutPath: string;
    stderrPath: string;
    timedOut: boolean;
  };
  artifacts: {
    gitStatusPath: string;
    gitDiffPath: string;
    progressPath?: string;
    sessionCatalogPath?: string;
    traceFiles: string[];
  };
  checks: EvalCheckResult[];
  metrics: EvalTraceMetrics;
  model?: string;
  maxSteps?: number;
};

export type EvalSuiteReport = {
  version: 1;
  target: string;
  repoRoot: string;
  startedAt: string;
  finishedAt: string;
  resultsDir: string;
  results: EvalRunResult[];
};
