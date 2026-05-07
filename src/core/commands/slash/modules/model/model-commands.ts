import { matchesAnyExactSlashCommand, matchesExactSlashCommand, matchesSlashCommandPrefix } from '../../parser.js';
import type { SlashCommandResult } from '../../result-types.js';
import type { SlashCommandModule } from '../../types.js';
import type { SlashCommandExecutionContext } from '../context.js';
import { argumentAfterPrefix, slashMessageResult } from '../results.js';
import { COMMON_BUILT_IN_MODELS, formatBuiltInModelGroups } from '../../../../llm/openai-models.js';
import {
  credentialModeFromSource,
  resolveDefaultReasoningEffort,
  supportsReasoningEffort,
  validateModelCredentialCompatibility,
} from '../../../../llm/model-policy.js';
import type { LlmProvider, ReasoningEffort } from '../../../../llm/types.js';

export const MODEL_LIST_MESSAGE = ['Common built-in model choices', '', formatBuiltInModelGroups()].join('\n');
export const MODEL_SET_HELP_MESSAGE = 'Use /model set <query> to filter models, then use arrows and Enter to choose one.';

const MODEL_SUBCOMMAND_RESULTS = new Map<string, SlashCommandResult>([
  ['list', slashMessageResult(MODEL_LIST_MESSAGE)],
  ['set', slashMessageResult(MODEL_SET_HELP_MESSAGE)],
]);

export function createModelSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
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

export function createReasoningSlashCommandModule(): SlashCommandModule<SlashCommandResult, SlashCommandExecutionContext> {
  return {
    id: 'reasoning',
    hints: [
      { command: '/reasoning', description: 'show reasoning effort for the current session' },
      { command: '/reasoning low', description: 'set reasoning effort to low' },
      { command: '/reasoning medium', description: 'set reasoning effort to medium' },
      { command: '/reasoning high', description: 'set reasoning effort to high' },
      { command: '/reasoning ultrahigh', description: 'set reasoning effort to ultrahigh' },
      { command: '/reasoning default', description: 'clear explicit reasoning effort and use the model default' },
    ],
    commands: [
      {
        id: 'reasoning.current',
        syntax: '/reasoning',
        description: 'show reasoning effort for the current session',
        match: matchesExactSlashCommand('/reasoning'),
        run: (context) => slashMessageResult(formatReasoningEffortStatus(context.model.active(), context.model.activeReasoningEffort())),
      },
      {
        id: 'reasoning.set',
        syntax: '/reasoning <low|medium|high|ultrahigh|default>',
        description: 'set reasoning effort for the current session',
        match: matchesSlashCommandPrefix('/reasoning'),
        run: (context, input) => setReasoningEffort(context, argumentAfterPrefix(input, '/reasoning')),
      },
    ],
  };
}

function switchModel(
  context: SlashCommandExecutionContext,
  value: string,
): SlashCommandResult {
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

function setReasoningEffort(
  context: SlashCommandExecutionContext,
  value: string,
): SlashCommandResult {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return slashMessageResult(formatReasoningEffortStatus(context.model.active(), context.model.activeReasoningEffort()));
  }

  if (normalized === 'default') {
    context.model.setReasoningEffort(undefined);
    return slashMessageResult(
      `Cleared explicit reasoning effort for ${context.model.active()}. Effective default: ${resolveDefaultReasoningEffort(context.model.active()) ?? 'not supported'}.`,
    );
  }

  if (!isReasoningEffort(normalized)) {
    return slashMessageResult('Usage: /reasoning <low|medium|high|ultrahigh|default>');
  }

  if (!supportsReasoningEffort(context.model.active())) {
    return slashMessageResult(`Reasoning effort is not supported for model ${context.model.active()}.`);
  }

  context.model.setReasoningEffort(normalized);
  return slashMessageResult(`Set reasoning effort to ${normalized} for ${context.model.active()}.`);
}

function formatReasoningEffortStatus(model: string, explicitEffort: ReasoningEffort | undefined): string {
  const supported = supportsReasoningEffort(model);
  const effective = explicitEffort ?? resolveDefaultReasoningEffort(model);
  return [
    `Current model: ${model}`,
    `Reasoning effort support: ${supported ? 'supported' : 'unsupported'}`,
    `Configured effort: ${explicitEffort ?? 'default'}`,
    `Effective effort: ${effective ?? 'none'}`,
    '',
    'Use /reasoning <low|medium|high|ultrahigh|default> to update this session.',
  ].join('\n');
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'ultrahigh';
}

function inferProviderForModel(model: string): LlmProvider {
  return model.startsWith('claude') ? 'anthropic' : 'openai';
}
