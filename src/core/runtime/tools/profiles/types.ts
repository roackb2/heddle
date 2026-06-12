export type ToolCapability =
  | 'workspace.read'
  | 'workspace.write'
  | 'shell.inspect'
  | 'shell.mutate'
  | 'memory.read'
  | 'memory.write'
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
  memoryMode?: 'none' | 'read-and-record' | 'maintainer' | 'legacy-full';
};
