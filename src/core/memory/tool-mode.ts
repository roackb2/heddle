export const MEMORY_TOOL_MODES = [
  'none',
  'read-only',
  'read-and-record',
  'maintainer',
  'legacy-full',
] as const;

/** Controls which Heddle-managed memory tools are available to one run. */
export type MemoryToolMode = typeof MEMORY_TOOL_MODES[number];
