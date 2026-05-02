export type ParsedSlashCommand = {
  raw: string;
  root: string;
  tokens: string[];
  rest: string;
};

export type SlashCommandHint = {
  command: string;
  description: string;
};

export type SlashCommand<Result, Context> = {
  id: string;
  syntax: string;
  description: string;
  aliases?: string[];
  match: (input: ParsedSlashCommand) => boolean;
  run: (context: Context, input: ParsedSlashCommand) => Promise<Result> | Result;
};

export type SlashCommandModule<Result, Context> = {
  id: string;
  commands: SlashCommand<Result, Context>[];
};

export type SlashCommandMatch<Result, Context> = {
  command: SlashCommand<Result, Context>;
  input: ParsedSlashCommand;
};

