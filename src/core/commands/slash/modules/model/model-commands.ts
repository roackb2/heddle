import { matchesAnyExactSlashCommand, matchesExactSlashCommand, matchesSlashCommandPrefix } from '../../parser.js';
import type { SlashCommandModule } from '../../types.js';
import type { CoreSlashCommandResult, SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, slashMessageResult } from '../results.js';
import { COMMON_BUILT_IN_MODELS, formatBuiltInModelGroups } from '../../../../llm/openai-models.js';
import { credentialModeFromSource, validateModelCredentialCompatibility } from '../../../../llm/model-policy.js';
import type { LlmProvider } from '../../../../llm/types.js';

export const MODEL_LIST_MESSAGE = ['Common built-in model choices', '', formatBuiltInModelGroups()].join('\n');
export const MODEL_SET_HELP_MESSAGE = 'Use /model set <query> to filter models, then use arrows and Enter to choose one.';

const MODEL_SUBCOMMAND_RESULTS = new Map<string, CoreSlashCommandResult>([
  ['list', slashMessageResult(MODEL_LIST_MESSAGE)],
  ['set', slashMessageResult(MODEL_SET_HELP_MESSAGE)],
]);

export function createModelSlashCommandModule(): SlashCommandModule<CoreSlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'model',
    hints: [
      { command: '/model', description: 'show the active model' },
      { command: '/model <name>', description: 'switch the current model' },
      { command: '/model set [query]', description: 'pick a model with filtering' },
      { command: '/model list', description: 'list common built-in models' },
    ],
    commands: [
      {
        id: 'model.list',
        syntax: '/model list',
        aliases: ['/models'],
        description: 'list common built-in models',
        match: matchesAnyExactSlashCommand(['/model list', '/models']),
        run: () => slashMessageResult(MODEL_LIST_MESSAGE),
      },
      {
        id: 'model.current',
        syntax: '/model',
        description: 'show the active model',
        match: matchesExactSlashCommand('/model'),
        run: (context) => slashMessageResult(`Current model: ${context.model.active()}`),
      },
      {
        id: 'model.set.help',
        syntax: '/model set',
        description: 'pick a model with filtering',
        match: matchesExactSlashCommand('/model set'),
        run: () => slashMessageResult(MODEL_SET_HELP_MESSAGE),
      },
      {
        id: 'model.switch',
        syntax: '/model <name>',
        description: 'switch the current model',
        match: matchesSlashCommandPrefix('/model'),
        run: (context, input) => switchModel(context, argumentAfterPrefix(input, '/model')),
      },
    ],
  };
}

function switchModel(
  context: SlashCommandExecutionContext,
  value: string,
): CoreSlashCommandResult {
  if (!value) {
    return slashMessageResult('Usage: /model <name>');
  }

  const aliased = MODEL_SUBCOMMAND_RESULTS.get(value);
  if (aliased) {
    return aliased;
  }

  const compatibility = validateModelCredentialCompatibility({
    model: value,
    provider: inferProviderForModel(value),
    credentialMode: credentialModeFromSource(context.model.credentialSource()),
  });
  if (!compatibility.ok) {
    return slashMessageResult(compatibility.error);
  }

  context.model.setActive(value);
  return slashMessageResult(
    COMMON_BUILT_IN_MODELS.includes(value) ?
      `Switched model to ${value}`
    : `Switched model to ${value}. This name is not in Heddle's common shortlist, so the next API call will fail if the provider does not recognize it.`,
  );
}

function inferProviderForModel(model: string): LlmProvider {
  return model.startsWith('claude') ? 'anthropic' : 'openai';
}
