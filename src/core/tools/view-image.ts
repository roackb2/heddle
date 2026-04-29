// ---------------------------------------------------------------------------
// Tool: view_image
// Host-side image viewing MVP backed by the active model provider.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import OpenAI from 'openai';
import type { ResponseInputImage, ResponseInputText, ResponseStreamEvent } from 'openai/resources/responses/responses.js';
import type { ToolDefinition, ToolResult } from '../types.js';
import { OPENAI_CODEX_RESPONSES_ENDPOINT } from '../auth/openai-oauth.js';
import { inferProviderFromModel } from '../llm/factory.js';
import { createOpenAiOAuthFetch } from '../llm/openai.js';
import {
  resolveOpenAiOAuthImageCandidateModels,
  validateModelCredentialCompatibility,
} from '../llm/model-policy.js';
import type { LlmProvider } from '../llm/types.js';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '../config.js';
import { resolveOAuthCredentialForModel, type ProviderCredentialSource } from '../runtime/api-keys.js';

type ViewImageInput = {
  path: string;
  prompt?: string;
};

export type ViewImageToolOptions = {
  model?: string;
  provider?: LlmProvider;
  apiKey?: string;
  providerCredentialSource?: ProviderCredentialSource;
  credentialStorePath?: string;
  workspaceRoot?: string;
};

const DEFAULT_IMAGE_PROMPT =
  'Describe the image for a coding assistant. Focus on UI text, error messages, filenames, commands, code, diagrams, and any details relevant to software work.';

export const viewImageTool: ToolDefinition = createViewImageTool();

export function createViewImageTool(options: ViewImageToolOptions = {}): ToolDefinition {
  return {
    name: 'view_image',
    description:
      'Inspect a local image file when the user references a screenshot, diagram, or other visual file path and the image contents are actually needed. Use this only after the user has provided or implied a concrete image path. Input example: { "path": "/absolute/path/to/screenshot.png" }. Optional field: prompt for a more specific visual question. Returns a concise text description of the image contents.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the local image file.',
        },
        prompt: {
          type: 'string',
          description: 'Optional focused instruction for what to extract from the image.',
        },
      },
      required: ['path'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isViewImageInput(raw)) {
        return {
          ok: false,
          error: 'Invalid input for view_image. Required field: path. Optional field: prompt.',
        };
      }

      const input = raw as ViewImageInput;
      const workspaceRoot = options.workspaceRoot ?? process.cwd();
      const filePath = resolve(workspaceRoot, input.path);
      const mediaType = detectMediaType(filePath);
      if (!mediaType) {
        return {
          ok: false,
          error: 'view_image supports .png, .jpg, .jpeg, .gif, and .webp files.',
        };
      }

      const provider = options.provider ?? inferProviderFromModel(options.model ?? DEFAULT_OPENAI_MODEL);
      const prompt = input.prompt?.trim() || DEFAULT_IMAGE_PROMPT;

      try {
        const data = await readFile(filePath);

        switch (provider) {
          case 'openai':
            return await executeOpenAiImageView({ filePath, mediaType, data, prompt, options });
          case 'anthropic':
            return await executeAnthropicImageView({ filePath, mediaType, data, prompt, options });
          case 'google':
            return {
              ok: false,
              error: 'view_image is not wired for Google models yet.',
            };
        }
      } catch (error) {
        return {
          ok: false,
          error: formatImageViewFailure(error),
        };
      }
    },
  };
}

async function executeOpenAiImageView(args: {
  filePath: string;
  mediaType: string;
  data: Buffer;
  prompt: string;
  options: ViewImageToolOptions;
}): Promise<ToolResult> {
  const model = args.options.model ?? DEFAULT_OPENAI_MODEL;
  const oauthCredential =
    args.options.providerCredentialSource?.type === 'oauth' ?
      resolveOAuthCredentialForModel(model, { storePath: args.options.credentialStorePath })
    : undefined;

  if (args.options.providerCredentialSource?.type === 'oauth' && !oauthCredential) {
    return {
      ok: false,
      error: 'view_image could not load the stored OpenAI account sign-in credential for this workspace. Sign in again with `heddle auth login openai`, or set OPENAI_API_KEY to use Platform API-key mode.',
    };
  }

  const compatibility = validateModelCredentialCompatibility({
    model,
    provider: 'openai',
    credentialMode: oauthCredential ? 'oauth' : undefined,
    usageLabel: 'image inspection',
  });
  if (!compatibility.ok) {
    return {
      ok: false,
      error: compatibility.error,
    };
  }

  const apiKey = firstDefinedNonEmpty(args.options.apiKey, process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
  if (!oauthCredential && !apiKey) {
    return {
      ok: false,
      error: 'view_image requires OPENAI_API_KEY (or PERSONAL_OPENAI_API_KEY) when the active model provider is OpenAI.',
    };
  }

  const oauthFetch =
    oauthCredential ? createOpenAiOAuthFetch(oauthCredential, { storePath: args.options.credentialStorePath })
    : undefined;
  const client = new OpenAI({
    apiKey: oauthCredential ? 'heddle-oauth-placeholder' : apiKey,
    fetch: oauthFetch,
  });
  const imageBase64 = args.data.toString('base64');
  const candidateModels = oauthCredential ? resolveOpenAiOAuthImageCandidateModels(model) : [model];
  let lastError: unknown;

  for (const candidateModel of candidateModels) {
    try {
      const response = oauthCredential ?
        await executeOpenAiOAuthImageStream({
          oauthFetch,
          accountId: oauthCredential.accountId,
          model: candidateModel,
          prompt: args.prompt,
          imageUrl: `data:${args.mediaType};base64,${imageBase64}`,
        })
      : await client.responses.create({
          model: candidateModel,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: args.prompt } satisfies ResponseInputText,
              {
                type: 'input_image',
                detail: 'auto',
                image_url: `data:${args.mediaType};base64,${imageBase64}`,
              } satisfies ResponseInputImage,
            ],
          }],
        });

      return {
        ok: true,
        output: {
          provider: 'openai',
          model: response.model,
          path: args.filePath,
          summary: response.output_text?.trim() || 'No image description returned.',
        },
      };
    } catch (error) {
      lastError = error;
      if (!oauthCredential || !shouldRetryOpenAiOAuthImageModel(error)) {
        throw enrichOpenAiImageError(error, candidateModel, oauthCredential ? 'oauth' : 'api-key', {
          attemptedModels: candidateModels,
          currentModel: candidateModel,
        });
      }
    }
  }

  throw enrichOpenAiImageError(lastError, candidateModels[candidateModels.length - 1] ?? model, 'oauth', {
    attemptedModels: candidateModels,
    currentModel: candidateModels[candidateModels.length - 1] ?? model,
  });
}

async function executeOpenAiOAuthImageStream(args: {
  oauthFetch: ReturnType<typeof createOpenAiOAuthFetch> | undefined;
  accountId?: string;
  model: string;
  prompt: string;
  imageUrl: string;
}): Promise<{ model: string; output_text?: string }> {
  if (!args.oauthFetch) {
    throw new Error('Missing OAuth fetch implementation for OpenAI image inspection.');
  }

  const headers = { 'content-type': 'application/json' };
  const body = JSON.stringify({
    model: args.model,
    store: false,
    stream: true,
    reasoning: { summary: 'auto' },
    instructions: 'You are a helpful vision assistant. Describe the provided screenshot briefly and focus on visible UI text, structure, and notable details.',
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: args.prompt } satisfies ResponseInputText,
        {
          type: 'input_image',
          detail: 'auto',
          image_url: args.imageUrl,
        } satisfies ResponseInputImage,
      ],
    }],
  });

  const response = await args.oauthFetch(OPENAI_CODEX_RESPONSES_ENDPOINT, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const failureBody = await response.text();
    const failure = new Error(failureBody || `${response.status} status code (no body)`);
    (failure as Error & { status?: number }).status = response.status;
    throw failure;
  }

  const text = await response.text();
  const outputText = extractOutputTextFromSse(text);
  return {
    model: args.model,
    output_text: outputText || undefined,
  };
}

async function executeAnthropicImageView(args: {
  filePath: string;
  mediaType: string;
  data: Buffer;
  prompt: string;
  options: ViewImageToolOptions;
}): Promise<ToolResult> {
  const apiKey = firstDefinedNonEmpty(args.options.apiKey, process.env.ANTHROPIC_API_KEY, process.env.PERSONAL_ANTHROPIC_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      error: 'view_image requires ANTHROPIC_API_KEY (or PERSONAL_ANTHROPIC_API_KEY) when the active model provider is Anthropic.',
    };
  }

  const anthropicMediaType = toAnthropicMediaType(args.mediaType);
  if (!anthropicMediaType) {
    return {
      ok: false,
      error: 'Anthropic image viewing supports jpeg, png, gif, and webp.',
    };
  }

  const client = new Anthropic({ apiKey });
  const model = args.options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: anthropicMediaType,
            data: args.data.toString('base64'),
          },
        } satisfies ImageBlockParam,
        {
          type: 'text',
          text: args.prompt,
        },
      ],
    }],
  });

  return {
    ok: true,
    output: {
      provider: 'anthropic',
      model: response.model,
      path: args.filePath,
      summary:
        response.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim() || 'No image description returned.',
    },
  };
}

function isViewImageInput(raw: unknown): raw is ViewImageInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'path' && key !== 'prompt')) {
    return false;
  }

  if (typeof input.path !== 'string' || input.path.trim().length === 0) {
    return false;
  }

  return input.prompt === undefined || typeof input.prompt === 'string';
}

function detectMediaType(filePath: string): string | undefined {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

function toAnthropicMediaType(mediaType: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | undefined {
  if (
    mediaType === 'image/jpeg'
    || mediaType === 'image/png'
    || mediaType === 'image/gif'
    || mediaType === 'image/webp'
  ) {
    return mediaType;
  }

  return undefined;
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

function shouldRetryOpenAiOAuthImageModel(error: unknown): boolean {
  const status = readOpenAiErrorStatus(error);
  return status === 400 || status === 404;
}

function enrichOpenAiImageError(
  error: unknown,
  model: string,
  authMode: 'oauth' | 'api-key',
  options: { attemptedModels?: string[]; currentModel?: string } = {},
): Error {
  const status = readOpenAiErrorStatus(error);
  const details = readOpenAiErrorDetails(error);
  const modeDetail = authMode === 'oauth' ? 'OpenAI account sign-in mode' : 'OpenAI API-key mode';
  const statusDetail = status ? `status ${status}` : 'unknown status';
  const attemptedModels = options.attemptedModels?.length ? uniqueModels(options.attemptedModels) : [model];
  const attemptSuffix = attemptedModels.length > 1 ? ` Attempted models: ${attemptedModels.join(', ')}.` : '';
  const currentModelSuffix = options.currentModel && options.currentModel !== model ? ` Last attempted model: ${options.currentModel}.` : '';
  const detailSuffix = details ? ` ${details}` : '';
  return new Error(
    `OpenAI image inspection failed for model ${model} in ${modeDetail}: ${statusDetail}.${detailSuffix}${attemptSuffix}${currentModelSuffix}`.trim(),
  );
}

function readOpenAiErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  return typeof candidate.status === 'number' ? candidate.status
    : typeof candidate.response?.status === 'number' ? candidate.response.status
    : undefined;
}

function formatImageViewFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Image view failed: ${message}`;
}

function extractOutputTextFromSse(text: string): string {
  const chunks = text.split('\n\n');
  let output = '';

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const dataLine = lines.find((line) => line.startsWith('data: '));
    if (!dataLine) {
      continue;
    }

    try {
      const payload = JSON.parse(dataLine.slice(6)) as ResponseStreamEvent;
      if (payload.type === 'response.output_text.delta' && payload.delta) {
        output += payload.delta;
      }
      if (payload.type === 'response.output_text.done' && payload.text) {
        output = payload.text;
      }
    } catch {
      continue;
    }
  }

  return output.trim();
}

function readOpenAiErrorDetails(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return error instanceof Error ? error.message : undefined;
  }

  const candidate = error as {
    message?: unknown;
    error?: { message?: unknown; type?: unknown; code?: unknown; param?: unknown };
    response?: { data?: unknown; body?: unknown };
  };

  const directMessage = typeof candidate.message === 'string' ? candidate.message.trim() : '';
  if (directMessage && directMessage !== '400 status code (no body)' && directMessage !== '404 status code (no body)') {
    return directMessage;
  }

  const nested = candidate.error;
  if (nested && typeof nested === 'object') {
    const parts = [nested.message, nested.type, nested.code, nested.param]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }

  const responsePayload = candidate.response?.data ?? candidate.response?.body;
  if (typeof responsePayload === 'string' && responsePayload.trim()) {
    return responsePayload.trim();
  }

  if (responsePayload && typeof responsePayload === 'object') {
    try {
      return JSON.stringify(responsePayload);
    } catch {
      return undefined;
    }
  }

  if (directMessage) {
    return directMessage;
  }

  return error instanceof Error ? error.message : undefined;
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
