import type { Logger } from 'pino';
import { createCyberLoopKinematicsObserver, type CyberLoopKinematicsObserver, type LlmAdapter } from '../../../index.js';
import { resolveApiKeyForModel, resolveProviderCredentialSourceForModel } from '../utils/runtime.js';
import type { ChatRuntimeConfig } from '../utils/runtime.js';
import type { ChatDriftObserverOptions } from './useAgentRun.js';

export async function createTuiChatDriftObserver(args: {
  prompt: string;
  referenceAssistantText?: string;
  llm: LlmAdapter;
  runtime: ChatRuntimeConfig;
  logger: Logger;
  options: ChatDriftObserverOptions | undefined;
}): Promise<CyberLoopKinematicsObserver | undefined> {
  const { prompt, referenceAssistantText, llm, runtime, logger, options } = args;
  if (!options?.enabled) {
    return undefined;
  }

  const llmInfo = llm.info;
  const credentialSource = llmInfo?.provider === 'openai' ?
    resolveProviderCredentialSourceForModel(llmInfo.model, runtime)
  : undefined;
  if (credentialSource?.type === 'oauth') {
    const message = 'CyberLoop drift detection requires OpenAI Platform API-key mode for embeddings; active auth is OpenAI account sign-in.';
    logger.debug({ model: llmInfo?.model, credentialSource: credentialSource.type }, message);
    options.onError?.(new Error(message));
    return undefined;
  }

  try {
    return await createCyberLoopKinematicsObserver({
      goal: prompt,
      referenceText: referenceAssistantText,
      apiKey: llm.info?.provider === 'openai' ? resolveApiKeyForModel(llm.info.model, runtime) : undefined,
      onAnnotation: options.onAnnotation,
      onError: (error) => {
        logger.debug(
          { error: error instanceof Error ? error.message : String(error) },
          'CyberLoop drift observer failed',
        );
        options.onError?.(error);
      },
    });
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      'CyberLoop drift observer unavailable',
    );
    options.onError?.(error);
    return undefined;
  }
}
