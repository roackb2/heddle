// ---------------------------------------------------------------------------
// Tool: view_image
// Host-side image viewing MVP backed by the active model provider.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import OpenAI from 'openai';
import type { ResponseInputImage, ResponseInputText } from 'openai/resources/responses/responses.js';
import type { ToolDefinition, ToolResult } from '../../../types.js';
import { LlmAdapterService } from '../../../llm/index.js';
import {
  OpenAiCodexSseService,
  OpenAiOAuthFetchService,
} from '../../../llm/adapters/openai/index.js';
import { ModelPolicyService } from '../../../llm/models/index.js';
import type { LlmProvider } from '../../../llm/types.js';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '../../../config.js';
import {
  RuntimeCredentialService,
  type ProviderCredentialSource,
  type ResolvedProviderCredential,
} from '../../../runtime/credentials/index.js';

type ViewImageInput = {
  path?: string;
  paths?: string[];
  prompt?: string;
};

type ImageViewFile = {
  path: string;
  mediaType: string;
  data: Buffer;
};

export type ViewImageToolOptions = {
  model?: string;
  provider?: LlmProvider;
  apiKey?: string;
  credential?: ResolvedProviderCredential;
  providerCredentialSource?: ProviderCredentialSource;
  credentialStorePath?: string;
  workspaceRoot?: string;
};

const DEFAULT_IMAGE_PROMPT =
  'Describe the image for a coding assistant. Focus on UI text, error messages, filenames, commands, code, diagrams, and any details relevant to software work.';
const MAX_IMAGE_VIEW_FILES = 10;

export const viewImageTool: ToolDefinition = createViewImageTool();

export function createViewImageTool(options: ViewImageToolOptions = {}): ToolDefinition {
  return {
    name: 'view_image',
    description:
      'Inspect one or more local image files when the user references screenshots, diagrams, or other visual file paths and the image contents are actually needed. Use this only after the user has provided or implied concrete image paths. Input examples: { "path": "/absolute/path/to/screenshot.png" } or { "paths": ["/absolute/path/to/a.png", "/absolute/path/to/b.png"] }. Optional field: prompt for a more specific visual question. Returns a concise text description of the image contents.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the local image file.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to local image files.',
        },
        prompt: {
          type: 'string',
          description: 'Optional focused instruction for what to extract from the image.',
        },
      },
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isViewImageInput(raw)) {
        return {
          ok: false,
          error: 'Invalid input for view_image. Required field: path or paths. Optional field: prompt.',
        };
      }

      const input = raw as ViewImageInput;
      const workspaceRoot = options.workspaceRoot ?? process.cwd();
      const paths = normalizeImagePaths(input);
      if (paths.length > MAX_IMAGE_VIEW_FILES) {
        return {
          ok: false,
          error: `view_image supports at most ${MAX_IMAGE_VIEW_FILES} images per call.`,
        };
      }

      const provider = options.provider ?? LlmAdapterService.inferProvider(options.model ?? DEFAULT_OPENAI_MODEL);
      const prompt = input.prompt?.trim() || DEFAULT_IMAGE_PROMPT;
      const fileInputs = paths.flatMap((path) => {
        const filePath = resolve(workspaceRoot, path);
        const mediaType = detectMediaType(filePath);
        if (!mediaType) {
          return [];
        }

        return [{ filePath, mediaType }];
      });
      if (fileInputs.length !== paths.length) {
        return {
          ok: false,
          error: 'view_image supports .png, .jpg, .jpeg, .gif, and .webp files.',
        };
      }

      try {
        const files = await Promise.all(fileInputs.map(async (file) => {
          return {
            path: file.filePath,
            mediaType: file.mediaType,
            data: await readFile(file.filePath),
          } satisfies ImageViewFile;
        }));

        switch (provider) {
          case 'openai':
            return await executeOpenAiImageView({ files, prompt, options });
          case 'anthropic':
            return await executeAnthropicImageView({ files, prompt, options });
          case 'google':
            return {
              ok: false,
              error: 'view_image is not wired for Google models yet.',
            };
          case 'ollama':
          case 'lmstudio':
          case 'litellm':
          case 'vllm':
          case 'huggingface':
          case 'openrouter':
          case 'together':
          case 'groq':
            return {
              ok: false,
              error: `view_image is not wired for ${provider} models yet.`,
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
  files: ImageViewFile[];
  prompt: string;
  options: ViewImageToolOptions;
}): Promise<ToolResult> {
  const model = args.options.model ?? DEFAULT_OPENAI_MODEL;
  const oauthCredential =
    OpenAiOAuthFetchService.isAccountCredential(args.options.credential) ? args.options.credential
    : args.options.providerCredentialSource?.type === 'oauth' ?
      RuntimeCredentialService.resolveOAuthCredentialForModel(model, { storePath: args.options.credentialStorePath })
    : undefined;

  const expectsOAuth = args.options.providerCredentialSource?.type === 'oauth'
    || args.options.providerCredentialSource?.type === 'oauth-access-token';
  if (expectsOAuth && !oauthCredential) {
    return {
      ok: false,
      error: args.options.providerCredentialSource?.type === 'oauth-access-token' ?
          'view_image did not receive the request-scoped OpenAI access token for this run. Sign in again and retry.'
        : 'view_image could not load the stored OpenAI account sign-in credential for this workspace. Sign in again with `heddle auth login openai`, or set OPENAI_API_KEY to use Platform API-key mode.',
    };
  }

  const compatibility = ModelPolicyService.validateCredentialCompatibility({
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
    oauthCredential ? OpenAiOAuthFetchService.create(oauthCredential, { storePath: args.options.credentialStorePath })
    : undefined;
  const client = new OpenAI({
    apiKey: oauthCredential ? 'heddle-oauth-placeholder' : apiKey,
    fetch: oauthFetch,
  });
  const inputImages = args.files.map((file) => ({
    file,
    imageUrl: `data:${file.mediaType};base64,${file.data.toString('base64')}`,
  }));
  const candidateModels = oauthCredential ? ModelPolicyService.resolveOpenAiOAuthImageCandidateModels(model) : [model];
  let lastError: unknown;

  for (const candidateModel of candidateModels) {
    try {
      const response = oauthCredential ?
        await executeOpenAiOAuthImageStream({
          oauthFetch,
          accountId: oauthCredential.accountId,
          model: candidateModel,
          prompt: args.prompt,
          imageUrls: inputImages.map((image) => image.imageUrl),
        })
      : await client.responses.create({
          model: candidateModel,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: args.prompt } satisfies ResponseInputText,
              ...inputImages.map((image) => ({
                type: 'input_image',
                detail: 'auto',
                image_url: image.imageUrl,
              } satisfies ResponseInputImage)),
            ],
          }],
        });

      return {
        ok: true,
        output: {
          provider: 'openai',
          model: response.model,
          ...formatImageOutputPaths(args.files),
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
  oauthFetch: ReturnType<typeof OpenAiOAuthFetchService.create> | undefined;
  accountId?: string;
  model: string;
  prompt: string;
  imageUrls: string[];
}): Promise<{ model: string; output_text?: string }> {
  if (!args.oauthFetch) {
    throw new Error('Missing OAuth fetch implementation for OpenAI image inspection.');
  }

  const text = await OpenAiCodexSseService.execute({
    oauthFetch: args.oauthFetch,
    body: {
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
          ...args.imageUrls.map((imageUrl) => ({
            type: 'input_image',
            detail: 'auto',
            image_url: imageUrl,
          } satisfies ResponseInputImage)),
        ],
      }],
    },
  });

  const outputText = OpenAiCodexSseService.extractOutputText(text);
  return {
    model: args.model,
    output_text: outputText || undefined,
  };
}

async function executeAnthropicImageView(args: {
  files: ImageViewFile[];
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

  const imageBlocks = args.files.map((file): ImageBlockParam | undefined => {
    const anthropicMediaType = toAnthropicMediaType(file.mediaType);
    if (!anthropicMediaType) {
      return undefined;
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: anthropicMediaType,
        data: file.data.toString('base64'),
      },
    };
  });
  if (imageBlocks.some((block) => !block)) {
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
        ...imageBlocks.filter((block): block is ImageBlockParam => Boolean(block)),
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
      ...formatImageOutputPaths(args.files),
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
  if (keys.some((key) => key !== 'path' && key !== 'paths' && key !== 'prompt')) {
    return false;
  }

  const hasPath = typeof input.path === 'string' && input.path.trim().length > 0;
  const hasPaths = Array.isArray(input.paths)
    && input.paths.length > 0
    && input.paths.every((path) => typeof path === 'string' && path.trim().length > 0);
  if (!hasPath && !hasPaths) {
    return false;
  }

  return input.prompt === undefined || typeof input.prompt === 'string';
}

function normalizeImagePaths(input: ViewImageInput): string[] {
  return [
    ...(typeof input.path === 'string' ? [input.path] : []),
    ...(input.paths ?? []),
  ].map((path) => path.trim());
}

function formatImageOutputPaths(files: ImageViewFile[]) {
  const paths = files.map((file) => file.path);
  return paths.length === 1 ? { path: paths[0] } : { paths };
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
