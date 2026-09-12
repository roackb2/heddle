import type { MemoryToolMode } from '@/core/memory/tool-mode.js';

export type ToolCapability =
  | 'agent.delegate'
  | 'workspace.read'
  | 'workspace.write'
  | 'shell.inspect'
  | 'shell.mutate'
  | 'memory.read'
  | 'memory.write'
  | 'artifact.read'
  | 'artifact.write'
  | 'external.read'
  | 'browser.read'
  | 'browser.action'
  | 'mcp.unknown'
  | 'internal.state';

export type RuntimeToolSelectionProfile = {
  preset: 'default' | 'inspect' | 'none' | 'custom';
  includeTools?: string[];
  excludeTools?: string[];
  allowedCapabilities?: ToolCapability[];
  deniedCapabilities?: ToolCapability[];
  memoryMode?: MemoryToolMode;
};
