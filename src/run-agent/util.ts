// ---------------------------------------------------------------------------
// Small utilities shared across the run-agent submodules.
// ---------------------------------------------------------------------------

export function extractShellCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export function normalizeToolInput(tool: string, input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const normalized = { ...(input as Record<string, unknown>) };

  if ((tool === 'list_files' || tool === 'read_file' || tool === 'search_files') && typeof normalized.path === 'string') {
    normalized.path = normalizePathValue(normalized.path);
  }

  if (tool === 'edit_file' && typeof normalized.path === 'string') {
    normalized.path = normalizePathValue(normalized.path);
  }

  if ((tool === 'run_shell_inspect' || tool === 'run_shell_mutate') && typeof normalized.command === 'string') {
    normalized.command = normalized.command.trim().replace(/\s+/g, ' ');
  }

  return normalized;
}

function normalizePathValue(path: string): string {
  const trimmed = path.trim();
  if (trimmed === './' || trimmed === '.') {
    return '.';
  }

  return trimmed.replace(/\/+$/, '') || '.';
}

export function isRecoverableToolError(error: string | undefined): boolean {
  if (!error) {
    return false;
  }

  return error.startsWith('Invalid input for ') || error.startsWith('Repeated tool call blocked:');
}

export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return (
    err.name === 'AbortError' ||
    err.name === 'APIUserAbortError' ||
    /aborted/i.test(err.message)
  );
}

export function buildRepeatedToolCallResult(tool: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `Repeated tool call blocked: ${tool} was already called ${2} times with the same input earlier in this run. Try a different tool or different input.`,
  };
}
