import { matchesAnyExactSlashCommand, matchesSlashCommandPrefix } from '../../parser.js';
import type { SlashCommandModule } from '../../types.js';
import type { CoreSlashCommandResult, SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, formatCommandError, slashMessageResult } from '../results.js';
import type { LlmProvider } from '../../../../llm/types.js';

const AUTH_PROVIDERS = new Set<LlmProvider>(['openai', 'anthropic', 'google']);

export function createAuthSlashCommandModule(): SlashCommandModule<CoreSlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'auth',
    hints: [
      { command: '/auth', description: 'show stored provider credentials' },
      { command: '/auth status', description: 'show stored provider credentials' },
      { command: '/auth login openai', description: 'sign in with OpenAI ChatGPT/Codex OAuth' },
      { command: '/auth logout <provider>', description: 'remove a stored provider credential' },
    ],
    commands: [
      {
        id: 'auth.status',
        syntax: '/auth status',
        aliases: ['/auth'],
        description: 'show stored provider credentials',
        match: matchesAnyExactSlashCommand(['/auth', '/auth status']),
        run: (context) => slashMessageResult(context.auth.status()),
      },
      {
        id: 'auth.login',
        syntax: '/auth login <provider>',
        description: 'sign in with a provider',
        match: matchesSlashCommandPrefix('/auth login'),
        run: (context, input) => login(context, argumentAfterPrefix(input, '/auth login')),
      },
      {
        id: 'auth.logout',
        syntax: '/auth logout <provider>',
        description: 'remove a stored provider credential',
        match: matchesSlashCommandPrefix('/auth logout'),
        run: (context, input) => logout(context, argumentAfterPrefix(input, '/auth logout')),
      },
    ],
  };
}

async function login(
  context: SlashCommandExecutionContext,
  value: string,
): Promise<CoreSlashCommandResult> {
  const provider = parseAuthProvider(value);
  if (!provider) {
    return slashMessageResult('Usage: /auth login <provider>');
  }

  try {
    return slashMessageResult(await context.auth.login(provider));
  } catch (error) {
    return slashMessageResult(`Auth login failed. ${formatCommandError(error)}`);
  }
}

function logout(
  context: SlashCommandExecutionContext,
  value: string,
): CoreSlashCommandResult {
  const provider = parseAuthProvider(value);
  if (!provider) {
    return slashMessageResult('Usage: /auth logout <provider>');
  }

  try {
    return slashMessageResult(context.auth.logout(provider));
  } catch (error) {
    return slashMessageResult(`Auth logout failed. ${formatCommandError(error)}`);
  }
}

function parseAuthProvider(value: string): LlmProvider | undefined {
  const provider = value.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return AUTH_PROVIDERS.has(provider as LlmProvider) ? provider as LlmProvider : undefined;
}
