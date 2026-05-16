import type { RunShellCapability, RunShellScope } from '@/core/tools/toolkits/shell-process/run-shell.js';

export type ApprovalMode = 'exact' | 'prefix' | 'tool';

export type ApprovalRuleTool = 'run_shell_mutate' | 'edit_file' | 'read_file' | 'list_files';

export type ProjectApprovalRule = {
  tool: ApprovalRuleTool;
  mode: ApprovalMode;
  command: string;
  scope: RunShellScope | 'workspace' | 'outside_workspace';
  capability: RunShellCapability | 'file_edit' | 'file_inspection';
  createdAt: string;
};
