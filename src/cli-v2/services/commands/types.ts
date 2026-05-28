import type { ControlPlaneSessionView } from '@/client-shared/api/types.js';

export type TerminalSlashCommandStatus = {
  label: string;
  detail?: string;
  tone: 'info' | 'success' | 'warning' | 'error';
};

export type TerminalSlashCommandResult =
  | { handled: false }
  | { handled: true; status: TerminalSlashCommandStatus; error?: undefined }
  | { handled: true; error: string; status?: undefined };

export type TerminalSlashCommandContext = {
  activeSessionId?: string;
  isRunActive: boolean;
  refreshSessions: () => Promise<ControlPlaneSessionView[]>;
  createSession: (input: { name?: string }) => Promise<ControlPlaneSessionView>;
  selectSession: (sessionId: string) => Promise<void>;
};

export type ParsedTerminalSlashCommand = {
  raw: string;
  root: string;
  rest: string;
};

export type TerminalSlashCommandHint = {
  command: string;
  description: string;
};

export type TerminalSlashCommandDefinition = {
  id: string;
  syntax: string;
  description: string;
  aliases?: string[];
  match: (input: ParsedTerminalSlashCommand) => boolean;
  execute: (
    context: TerminalSlashCommandContext,
    input: ParsedTerminalSlashCommand,
  ) => Promise<TerminalSlashCommandResult> | TerminalSlashCommandResult;
};

export type TerminalSlashCommandModule = {
  id: string;
  hints?: TerminalSlashCommandHint[];
  commands: TerminalSlashCommandDefinition[];
};
