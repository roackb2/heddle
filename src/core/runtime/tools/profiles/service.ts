import type { ToolDefinition } from '@/core/types.js';
import type { RuntimeToolSelectionProfile, ToolCapability } from './types.js';

const TOOL_CAPABILITIES: Record<string, ToolCapability[]> = {
  project_dashboard: ['workspace.read'],
  list_files: ['workspace.read'],
  read_file: ['workspace.read'],
  search_files: ['workspace.read'],
  edit_file: ['workspace.write'],
  delete_file: ['workspace.write'],
  move_file: ['workspace.write'],
  run_shell_inspect: ['shell.inspect'],
  run_shell_mutate: ['shell.mutate'],
  list_memory_notes: ['memory.read'],
  read_memory_note: ['memory.read'],
  search_memory_notes: ['memory.read'],
  edit_memory_note: ['memory.write'],
  memory_checkpoint: ['memory.write'],
  record_knowledge: ['memory.write'],
  artifact_dashboard: ['artifact.read'],
  list_artifacts: ['artifact.read'],
  read_artifact: ['artifact.read'],
  save_artifact: ['artifact.write'],
  set_current_artifact: ['artifact.write'],
  read_agent_skill: ['workspace.read'],
  view_image: ['external.read'],
  web_search: ['external.read'],
  browser_snapshot: ['browser.read'],
  browser_screenshot: ['browser.read'],
  browser_open: ['browser.action'],
  browser_click: ['browser.action'],
  browser_type: ['browser.action'],
  browser_close: ['browser.action'],
  mcp_list_tools: ['mcp.unknown'],
  mcp_call_tool: ['mcp.unknown'],
  update_plan: ['internal.state'],
};

const PROFILE_PRESETS: Record<RuntimeToolSelectionProfile['preset'], RuntimeToolSelectionProfile> = {
  default: { preset: 'default' },
  none: { preset: 'none' },
  inspect: {
    preset: 'inspect',
    allowedCapabilities: ['workspace.read', 'shell.inspect', 'artifact.read'],
    deniedCapabilities: ['workspace.write', 'shell.mutate', 'memory.write', 'artifact.write', 'browser.action', 'mcp.unknown'],
    memoryMode: 'none',
  },
  custom: { preset: 'custom' },
};

/**
 * Applies runtime-owned tool visibility policy before ToolRegistry construction.
 */
export class RuntimeToolProfileService {
  static apply(input: {
    tools: ToolDefinition[];
    profile?: RuntimeToolSelectionProfile;
  }): ToolDefinition[] {
    const profile = RuntimeToolProfileService.expandProfile(input.profile);
    if (profile.preset === 'none') {
      return [];
    }

    const included = new Set(profile.includeTools ?? []);
    const excluded = new Set(profile.excludeTools ?? []);
    const allowedCapabilities = new Set(profile.allowedCapabilities ?? []);
    const deniedCapabilities = new Set(profile.deniedCapabilities ?? []);

    return input.tools
      .map((tool) => RuntimeToolProfileService.withCapabilities(tool))
      .filter((tool) => {
        if (excluded.has(tool.name)) {
          return false;
        }

        const capabilities = RuntimeToolProfileService.capabilitiesFor(tool);
        if (capabilities.some((capability) => deniedCapabilities.has(capability))) {
          return false;
        }

        if (included.has(tool.name)) {
          return true;
        }

        return allowedCapabilities.size === 0
          || capabilities.every((capability) => allowedCapabilities.has(capability));
      });
  }

  static capabilitiesFor(tool: Pick<ToolDefinition, 'name' | 'capabilities'>): ToolCapability[] {
    return (tool.capabilities as ToolCapability[] | undefined)
      ?? (tool.name.startsWith('mcp__') ? ['mcp.unknown'] : undefined)
      ?? TOOL_CAPABILITIES[tool.name]
      ?? ['mcp.unknown'];
  }

  private static withCapabilities(tool: ToolDefinition): ToolDefinition {
    return tool.capabilities ? tool : {
      ...tool,
      capabilities: RuntimeToolProfileService.capabilitiesFor(tool),
    };
  }

  private static expandProfile(profile: RuntimeToolSelectionProfile | undefined): RuntimeToolSelectionProfile {
    const preset = profile?.preset ?? 'default';
    return {
      ...PROFILE_PRESETS[preset],
      ...profile,
      allowedCapabilities: profile?.allowedCapabilities ?? PROFILE_PRESETS[preset].allowedCapabilities,
      deniedCapabilities: profile?.deniedCapabilities ?? PROFILE_PRESETS[preset].deniedCapabilities,
      memoryMode: profile?.memoryMode ?? PROFILE_PRESETS[preset].memoryMode,
    };
  }
}
