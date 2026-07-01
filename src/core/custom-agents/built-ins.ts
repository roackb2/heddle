import type { CustomAgentDefinition } from './types.js';

const INSPECT_TOOLS = [
  'project_dashboard',
  'list_files',
  'read_file',
  'search_files',
  'run_shell_inspect',
  'read_agent_skill',
  'artifact_dashboard',
  'list_artifacts',
  'read_artifact',
];

export const BUILT_IN_CUSTOM_AGENTS: CustomAgentDefinition[] = [
  {
    schemaVersion: 1,
    id: 'builtin:code',
    name: 'Code',
    description: 'Default Heddle coding agent with the standard tool and approval profile.',
    source: 'built-in',
    modeAlias: 'code',
    runtime: {},
    tools: { preset: 'default' },
    approval: { preset: 'interactive' },
    promptAppendix: '',
  },
  {
    schemaVersion: 1,
    id: 'builtin:ask',
    name: 'Ask',
    description: 'Inspect the workspace and answer questions without making changes.',
    source: 'built-in',
    modeAlias: 'ask',
    runtime: { maxSteps: 60 },
    tools: {
      preset: 'inspect',
      includeTools: INSPECT_TOOLS,
      memoryMode: 'none',
    },
    approval: { preset: 'read_only' },
    promptAppendix: [
      'You are running in ask mode.',
      'Answer the user by inspecting the workspace and explaining findings.',
      'Do not edit files, run mutation commands, write memory, or change project state.',
      'When a requested answer cannot be supported by available read-only evidence, say what evidence is missing.',
    ].join('\n'),
  },
  {
    schemaVersion: 1,
    id: 'builtin:review',
    name: 'Review',
    description: 'Review code and repository changes without applying fixes.',
    source: 'built-in',
    modeAlias: 'review',
    runtime: { maxSteps: 80 },
    tools: {
      preset: 'inspect',
      includeTools: INSPECT_TOOLS,
      memoryMode: 'none',
    },
    approval: { preset: 'read_only' },
    promptAppendix: [
      'You are running in review mode.',
      'Prioritize bugs, behavioral regressions, missing tests, reliability risks, and maintainability issues.',
      'Lead with actionable findings grounded in file paths, command output, or trace evidence.',
      'Do not edit files, run mutation commands, write memory, or change project state.',
    ].join('\n'),
  },
];
