// ---------------------------------------------------------------------------
// Tool: view_image
// Host-side image viewing MVP backed by the active model provider.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import OpenAI from 'openai';
import type { ResponseInputImage, ResponseInputText } from 'openai/resources/responses/responses.js';
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from '../../../types.js';
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
import {
  ViewImageInputSchema,
  ViewImageOutputSchema,
  type ViewImageInput,
  type ViewImageOutput,
} from './schemas.js';

type ImageViewFile = {
  source:
    | { type: 'path'; value: string }
    | { type: 'reference'; value: string };
  mediaType: string;
  data: Buffer;
};

export type ViewImageResource = {
  bytes: Uint8Array | AsyncIterable<Uint8Array>;
  mediaType: string;
  byteSize?: number;
  checksumSha256?: string;
};

export type ViewImageResourceResolver = (
  reference: string,
  context: ToolExecutionContext,
) => Promise<ViewImageResource | null | undefined>;

export type ViewImageToolOptions = {
  model?: string;
  provider?: LlmProvider;
  apiKey?: string;
  credential?: ResolvedProviderCredential;
  providerCredentialSource?: ProviderCredentialSource;
  credentialStorePath?: string;
  workspaceRoot?: string;
  resourceResolver?: ViewImageResourceResolver;
  maxImageBytes?: number;
};

const DEFAULT_IMAGE_PROMPT =
  'Describe the image for a coding assistant. Focus on UI text, error messages, filenames, commands, code, diagrams, and any details relevant to software work.';
export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ViewImageToolDefinition = ToolDefinition<ViewImageInput, ViewImageOutput>;

export const viewImageTool: ViewImageToolDefinition = createViewImageTool();

export function createViewImageTool(options: ViewImageToolOptions = {}): ViewImageToolDefinition {
  const maxImageBytes = resolveMaxImageBytes(options.maxImageBytes);
  const supportsReferences = Boolean(options.resourceResolver);
  return {
    name: 'view_image',
    description:
      supportsReferences ?
        'Inspect one or more local image paths or host-authorized opaque image references when visual contents are needed. Input examples: { "path": "/absolute/path/to/screenshot.png" } or { "reference": "host-image-reference" }. Optional field: prompt for a more specific visual question. Returns a concise text description.'
      : 'Inspect one or more local image files when the user references screenshots, diagrams, or other visual file paths and the image contents are actually needed. Use this only after the user has provided or implied concrete image paths. Input examples: { "path": "/absolute/path/to/screenshot.png" } or { "paths": ["/absolute/path/to/a.png", "/absolute/path/to/b.png"] }. Optional field: prompt for a more specific visual question. Returns a concise text description of the image contents.',
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
        ...(supportsReferences ? {
          reference: {
            type: 'string',
            description: 'Opaque host-authorized image reference.',
          },
          references: {
            type: 'array',
            items: { type: 'string' },
            description: 'Opaque host-authorized image references.',
          },
        } : {}),
        prompt: {
          type: 'string',
          description: 'Optional focused instruction for what to extract from the image.',
        },
      },
      anyOf: [
        { required: ['path'] },
        { required: ['paths'] },
        ...(supportsReferences ? [
          { required: ['reference'] },
          { required: ['references'] },
        ] : []),
      ],
    },
    inputSchema: ViewImageInputSchema,
    outputSchema: ViewImageOutputSchema,
    async execute(raw: unknown, context?: ToolExecutionContext): Promise<ToolResult<ViewImageOutput>> {
      const parsed = ViewImageInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: supportsReferences ?
              'Invalid input for view_image. Required field: path, paths, reference, or references. Optional field: prompt.'
            : 'Invalid input for view_image. Required field: path or paths. Optional field: prompt.',
        };
      }

      const input = parsed.data;
      const workspaceRoot = options.workspaceRoot ?? process.cwd();
      const paths = normalizeImagePaths(input);
      if (paths.some((path) => !detectMediaType(resolve(workspaceRoot, path)))) {
        return {
          ok: false,
          error: 'view_image supports .png, .jpg, .jpeg, .gif, and .webp files.',
        };
      }
      const references = normalizeImageReferences(input);
      if (references.length > 0 && !options.resourceResolver) {
        return {
          ok: false,
          error: 'view_image cannot resolve opaque references because no host resource resolver is configured.',
        };
      }

      const provider = options.provider ?? LlmAdapterService.inferProvider(options.model ?? DEFAULT_OPENAI_MODEL);
      const prompt = input.prompt || DEFAULT_IMAGE_PROMPT;

      try {
        const files = await resolveImageViewFiles({
          input,
          workspaceRoot,
          resourceResolver: options.resourceResolver,
          maxImageBytes,
          context: context ?? {},
        });

        switch (provider) {
          case 'openai':
            return await executeOpenAiImageView({ files, prompt, options, signal: context?.signal });
          case 'anthropic':
            return await executeAnthropicImageView({ files, prompt, options, signal: context?.signal });
          case 'google':
            return {
              ok: false,
              error: 'view_image is not wired for Google models yet.',
            };
          case 'kimi':
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
  signal?: AbortSignal;
}): Promise<ToolResult<ViewImageOutput>> {
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
          signal: args.signal,
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
        }, { signal: args.signal });

      return {
        ok: true,
        output: ViewImageOutputSchema.parse({
          provider: 'openai',
          model: response.model,
          ...formatImageOutputSources(args.files),
          summary: response.output_text?.trim() || 'No image description returned.',
        }),
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
  signal?: AbortSignal;
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
    signal: args.signal,
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
  signal?: AbortSignal;
}): Promise<ToolResult<ViewImageOutput>> {
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
  }, { signal: args.signal });

  return {
    ok: true,
    output: ViewImageOutputSchema.parse({
      provider: 'anthropic',
      model: response.model,
      ...formatImageOutputSources(args.files),
      summary:
        response.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim() || 'No image description returned.',
    }),
  };
}

function normalizeImagePaths(input: ViewImageInput): string[] {
  return [
    ...(typeof input.path === 'string' ? [input.path] : []),
    ...(input.paths ?? []),
  ].map((path) => path.trim());
}

function normalizeImageReferences(input: ViewImageInput): string[] {
  return [
    ...(typeof input.reference === 'string' ? [input.reference] : []),
    ...(input.references ?? []),
  ].map((reference) => reference.trim());
}

async function resolveImageViewFiles(args: {
  input: ViewImageInput;
  workspaceRoot: string;
  resourceResolver?: ViewImageResourceResolver;
  maxImageBytes: number;
  context: ToolExecutionContext;
}): Promise<ImageViewFile[]> {
  const pathFiles = normalizeImagePaths(args.input).map(async (path): Promise<ImageViewFile> => {
    const filePath = resolve(args.workspaceRoot, path);
    const mediaType = detectMediaType(filePath);
    if (!mediaType) {
      throw new Error('Unsupported local image media type.');
    }

    args.context.signal?.throwIfAborted();
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      throw new Error('The requested image path is not a regular file.');
    }
    assertImageByteSize(metadata.size, args.maxImageBytes);
    const data = await readFile(
      filePath,
      args.context.signal ? { signal: args.context.signal } : undefined,
    );
    assertImageByteSize(data.byteLength, args.maxImageBytes);
    return {
      source: { type: 'path', value: filePath },
      mediaType,
      data,
    };
  });
  const referenceFiles = normalizeImageReferences(args.input).map(async (reference): Promise<ImageViewFile> => {
    if (!args.resourceResolver) {
      throw new Error('No host image resource resolver is configured.');
    }

    args.context.signal?.throwIfAborted();
    const resource = await args.resourceResolver(reference, args.context);
    args.context.signal?.throwIfAborted();
    if (!resource) {
      throw new Error('The host did not authorize or resolve the requested image reference.');
    }

    const mediaType = normalizeImageMediaType(resource.mediaType);
    if (!mediaType) {
      throw new Error('Host-resolved images must use image/png, image/jpeg, image/gif, or image/webp.');
    }
    if (resource.byteSize !== undefined) {
      assertExpectedImageByteSize(resource.byteSize);
      assertImageByteSize(resource.byteSize, args.maxImageBytes);
    }
    if (resource.checksumSha256 !== undefined && !/^[a-f\d]{64}$/i.test(resource.checksumSha256)) {
      throw new Error('Host-resolved image SHA-256 metadata must contain 64 hexadecimal characters.');
    }

    const data = await readImageResourceBytes({
      bytes: resource.bytes,
      maxImageBytes: args.maxImageBytes,
      signal: args.context.signal,
    });
    if (resource.byteSize !== undefined && data.byteLength !== resource.byteSize) {
      throw new Error('Host-resolved image byte count does not match its metadata.');
    }
    if (
      resource.checksumSha256 !== undefined
      && createHash('sha256').update(data).digest('hex') !== resource.checksumSha256.toLowerCase()
    ) {
      throw new Error('Host-resolved image failed its SHA-256 integrity check.');
    }

    return {
      source: { type: 'reference', value: reference },
      mediaType,
      data,
    };
  });

  return await Promise.all([...pathFiles, ...referenceFiles]);
}

async function readImageResourceBytes(args: {
  bytes: Uint8Array | AsyncIterable<Uint8Array>;
  maxImageBytes: number;
  signal?: AbortSignal;
}): Promise<Buffer> {
  if (args.bytes instanceof Uint8Array) {
    args.signal?.throwIfAborted();
    assertImageByteSize(args.bytes.byteLength, args.maxImageBytes);
    return Buffer.from(args.bytes);
  }
  if (!isAsyncByteIterable(args.bytes)) {
    throw new Error('Host-resolved image bytes must be a Uint8Array or async iterable of Uint8Array chunks.');
  }

  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of args.bytes) {
    args.signal?.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) {
      throw new Error('Host-resolved image streams must yield Uint8Array chunks.');
    }
    byteSize += chunk.byteLength;
    assertImageByteSize(byteSize, args.maxImageBytes);
    chunks.push(Buffer.from(chunk));
  }
  args.signal?.throwIfAborted();
  return Buffer.concat(chunks, byteSize);
}

function isAsyncByteIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return Boolean(
    value
    && typeof value === 'object'
    && Symbol.asyncIterator in value
    && typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function',
  );
}

function assertExpectedImageByteSize(byteSize: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error('Host-resolved image byte-size metadata must be a non-negative safe integer.');
  }
}

function assertImageByteSize(byteSize: number, maxImageBytes: number): void {
  if (byteSize > maxImageBytes) {
    throw new Error(`Image exceeds the configured ${maxImageBytes}-byte inspection limit.`);
  }
}

function resolveMaxImageBytes(value: number | undefined): number {
  const maxImageBytes = value ?? DEFAULT_MAX_IMAGE_BYTES;
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes <= 0) {
    throw new RangeError('view_image maxImageBytes must be a positive safe integer.');
  }
  return maxImageBytes;
}

function formatImageOutputSources(files: ImageViewFile[]) {
  const paths = files.flatMap((file) => file.source.type === 'path' ? [file.source.value] : []);
  const references = files.flatMap((file) => file.source.type === 'reference' ? [file.source.value] : []);
  return {
    ...(paths.length === 1 ? { path: paths[0] } : paths.length > 1 ? { paths } : {}),
    ...(references.length === 1 ? { reference: references[0] } : references.length > 1 ? { references } : {}),
  };
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

function normalizeImageMediaType(mediaType: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | undefined {
  return toAnthropicMediaType(mediaType.trim().toLowerCase());
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
