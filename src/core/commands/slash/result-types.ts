export type SlashCommandResult =
  | { handled: false }
  | { handled: true; kind: 'message'; message: string; sessionId?: string }
  | { handled: true; kind: 'continue'; sessionId?: string; message?: string }
  | { handled: true; kind: 'execute'; prompt: string; displayText: string; message?: string };
