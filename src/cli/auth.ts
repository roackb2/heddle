// v1 compatibility only: legacy src/cli/chat slash-command context imports this
// module. Remove once src/cli/chat is retired and all command-line behavior is
// owned by cli-v2.
export { AuthCliController } from '@/cli-v2/commands/auth-command.js';
export type { AuthCliCommand, AuthCliOptions } from '@/cli-v2/commands/auth-command.js';
