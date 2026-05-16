export function extractShellCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
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
