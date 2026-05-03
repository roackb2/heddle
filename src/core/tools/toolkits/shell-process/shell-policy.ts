export type RunShellScope = 'inspect' | 'workspace' | 'external';
export type RunShellRisk = 'low' | 'medium' | 'unknown';
export type RunShellCapability =
  | 'workspace_listing'
  | 'file_inspection'
  | 'workspace_search'
  | 'structured_inspection'
  | 'environment_inspection'
  | 'git_inspection'
  | 'dependency'
  | 'verification'
  | 'formatting'
  | 'file_operation'
  | 'git_staging'
  | 'project_script'
  | 'unknown_workspace';

export type RunShellPolicyDecision = {
  binary: string;
  scope: RunShellScope;
  risk: RunShellRisk;
  capability: RunShellCapability;
  reason: string;
};

export type RunShellRule = {
  binary: string;
  argsPrefix?: string[];
  scope: RunShellScope;
  risk: RunShellRisk;
  capability: RunShellCapability;
  reason: string;
};

export const DEFAULT_INSPECT_RULES: RunShellRule[] = [
  inspectRule('ls', 'workspace_listing', 'workspace listing'),
  inspectRule('nl', 'file_inspection', 'numbered file inspection'),
  inspectRule('cat', 'file_inspection', 'file inspection'),
  inspectRule('head', 'file_inspection', 'file inspection'),
  inspectRule('tail', 'file_inspection', 'file inspection'),
  inspectRule('wc', 'file_inspection', 'workspace inspection'),
  inspectRule('grep', 'workspace_search', 'workspace inspection'),
  inspectRule('rg', 'workspace_search', 'workspace inspection'),
  inspectRule('find', 'workspace_search', 'workspace inspection'),
  inspectRule('sed', 'file_inspection', 'workspace inspection'),
  inspectRule('sort', 'structured_inspection', 'workspace inspection'),
  inspectRule('uniq', 'structured_inspection', 'workspace inspection'),
  inspectRule('jq', 'structured_inspection', 'structured output inspection'),
  inspectRule('echo', 'environment_inspection', 'simple shell inspection'),
  inspectRule('pwd', 'environment_inspection', 'workspace location check'),
  inspectRule('which', 'environment_inspection', 'binary discovery'),
  inspectRule('file', 'file_inspection', 'file metadata inspection'),
  inspectRule('tree', 'workspace_listing', 'workspace tree inspection'),
  inspectRule('du', 'environment_inspection', 'workspace disk inspection'),
  inspectRule('df', 'environment_inspection', 'filesystem inspection'),
  inspectRule('git', 'git_inspection', 'git history inspection', ['log']),
  inspectRule('git', 'git_inspection', 'git diff inspection', ['diff']),
  inspectRule('git', 'git_inspection', 'git status inspection', ['status']),
  inspectRule('git', 'git_inspection', 'git object inspection', ['show']),
  inspectRule('git', 'git_inspection', 'git revision inspection', ['rev-parse']),
  inspectRule('git', 'git_inspection', 'git file inventory inspection', ['ls-files']),
  inspectRule('git', 'git_inspection', 'git content search inspection', ['grep']),
  inspectRule('git', 'git_inspection', 'git branch inspection', ['branch']),
  inspectRule('git', 'git_inspection', 'git tag inspection', ['tag']),
  inspectRule('git', 'git_inspection', 'git remote inspection', ['remote']),
];

export const DEFAULT_MUTATE_RULES: RunShellRule[] = [
  workspaceRule('yarn', 'medium', 'dependency', 'workspace dependency install command', ['add']),
  workspaceRule('yarn', 'medium', 'dependency', 'workspace dependency install command', ['install']),
  workspaceRule('yarn', 'medium', 'dependency', 'workspace dependency removal command', ['remove']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['test']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['build']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['lint']),
  workspaceRule('yarn', 'low', 'verification', 'workspace verification command', ['vitest']),
  workspaceRule('vitest', 'low', 'verification', 'workspace verification command'),
  workspaceRule('tsc', 'low', 'verification', 'workspace verification command'),
  workspaceRule('yarn', 'medium', 'project_script', 'workspace project script command', ['run']),
  workspaceRule('yarn', 'medium', 'formatting', 'workspace formatting command', ['format']),
  workspaceRule('yarn', 'medium', 'formatting', 'workspace formatting command', ['prettier']),
  workspaceRule('yarn', 'medium', 'formatting', 'workspace formatting command', ['eslint']),
  workspaceRule('npx', 'medium', 'formatting', 'workspace formatting command', ['prettier', '--write']),
  workspaceRule('npx', 'medium', 'formatting', 'workspace formatting command', ['eslint', '--fix']),
  workspaceRule('prettier', 'medium', 'formatting', 'workspace formatting command', ['--write']),
  workspaceRule('eslint', 'medium', 'formatting', 'workspace formatting command', ['--fix']),
  workspaceRule('mkdir', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('touch', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('mv', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('cp', 'medium', 'file_operation', 'workspace file operation'),
  workspaceRule('git', 'medium', 'git_staging', 'git staging operation', ['add']),
  workspaceRule('git', 'medium', 'file_operation', 'git file move operation', ['mv']),
];

export function classifyShellCommandPolicy(
  command: string,
  options: {
    toolName: string;
    rules: RunShellRule[];
    allowUnknown: boolean;
  },
): RunShellPolicyDecision | { error: string } {
  const normalized = command.trim();
  if (!normalized) {
    return { error: 'Command not allowed. The command must not be empty.' };
  }

  const mutateCatastrophicError = getCatastrophicCommandError(normalized, options.toolName);
  if (mutateCatastrophicError) {
    return { error: mutateCatastrophicError };
  }

  if (containsBlockedShellControlOperators(normalized, options.toolName)) {
    return {
      error:
        'Command not allowed. Inspect mode permits read-only pipes, but redirects, command chaining, backgrounding, and subshells are blocked.',
    };
  }

  const argv = tokenizeCommand(normalized);
  if (argv.length === 0) {
    return { error: 'Command not allowed. The command must not be empty.' };
  }

  const policy = classifyCommand(argv, options.rules, options.allowUnknown);
  if (!policy) {
    return {
      error: `Command not allowed by ${options.toolName} policy. This tool only permits bounded commands that match its configured workspace risk/scope rules.`,
    };
  }

  return policy;
}

export function containsBlockedShellControlOperators(command: string, toolName: string): boolean {
  const inspectMode = toolName === 'run_shell_inspect';
  if (!inspectMode) {
    return false;
  }
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index++) {
    const current = command[index] ?? '';
    const next = command[index + 1] ?? '';

    if (escaped) {
      escaped = false;
      continue;
    }

    if (current === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (current === quote) {
        quote = undefined;
      }
      continue;
    }

    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }

    if (current === '|' && inspectMode && next === '|') {
      return true;
    }

    if (current === '&' && next === '&') {
      return true;
    }

    if (current === ';' || current === '`') {
      return true;
    }

    if (current === '&') {
      return true;
    }

    if (inspectMode && (current === '>' || current === '<')) {
      return true;
    }

    if (current === '$' && next === '(') {
      return true;
    }
  }

  return false;
}

export function getCatastrophicCommandError(command: string, toolName: string): string | undefined {
  if (toolName !== 'run_shell_mutate') {
    return undefined;
  }

  const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) {
    return undefined;
  }

  const catastrophicPatterns = [
    /(?:^|[;&|])\s*rm\s+-rf\s+\/$/,
    /(?:^|[;&|])\s*rm\s+-rf\s+\/\s/,
    /(?:^|[;&|])\s*rm\s+-rf\s+~(?:\/|$)/,
    /(?:^|[;&|])\s*rm\s+-rf\s+\$home(?:\/|$)/,
    /(?:^|[;&|])\s*rm\s+-rf\s+"?\/"?(?:\s|$)/,
    /(?:^|[;&|])\s*rm\s+-rf\s+"?~"?(?:\s|$)/,
    /(?:^|[;&|])\s*mkfs(?:\.[^\s]+)?\b/,
    /(?:^|[;&|])\s*dd\b.*\bof=\/dev\//,
  ];

  return catastrophicPatterns.some((pattern) => pattern.test(normalized)) ?
      'Command not allowed. This command appears catastrophically destructive (home/root/disk-level) and is blocked even in approval-gated mutate mode.'
    : undefined;
}

function classifyCommand(
  argv: string[],
  rules: RunShellRule[],
  allowUnknown: boolean,
): RunShellPolicyDecision | undefined {
  const binary = argv[0] ?? '';
  const args = argv.slice(1);
  const rule = rules.find((candidate) => {
    if (candidate.binary !== binary) {
      return false;
    }

    if (!candidate.argsPrefix || candidate.argsPrefix.length === 0) {
      return true;
    }

    return candidate.argsPrefix.every((part, index) => args[index] === part);
  });

  if (!rule) {
    if (!allowUnknown) {
      return undefined;
    }

    return {
      binary,
      scope: 'workspace',
      risk: 'unknown',
      capability: 'unknown_workspace',
      reason: 'unclassified workspace command requiring explicit approval',
    };
  }

  return {
    binary: rule.binary,
    scope: rule.scope,
    risk: rule.risk,
    capability: rule.capability,
    reason: rule.reason,
  };
}

function tokenizeCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function inspectRule(
  binary: string,
  capability: RunShellCapability,
  reason: string,
  argsPrefix?: string[],
): RunShellRule {
  return {
    binary,
    argsPrefix,
    scope: 'inspect',
    risk: 'low',
    capability,
    reason,
  };
}

function workspaceRule(
  binary: string,
  risk: RunShellRisk,
  capability: RunShellCapability,
  reason: string,
  argsPrefix?: string[],
): RunShellRule {
  return {
    binary,
    argsPrefix,
    scope: 'workspace',
    risk,
    capability,
    reason,
  };
}
