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
import type { ToolDefinition, ToolResult } from '../../types.js';
import { inferProviderFromModel } from '../../llm/factory.js';
import type { LlmProvider } from '../../llm/types.js';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '../../config.js';

type ViewImageInput = {
  path: string;
  prompt?: string;
};

export type ViewImageToolOptions = {
  model?: string;
  provider?: LlmProvider;
  apiKey?: string;
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
      const filePath = resolve(input.path);
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
          error: `Image view failed: ${error instanceof Error ? error.message : String(error)}`,
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
  const apiKey = firstDefinedNonEmpty(args.options.apiKey, process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      error: 'view_image requires OPENAI_API_KEY (or PERSONAL_OPENAI_API_KEY) when the active model provider is OpenAI.',
    };
  }

  const client = new OpenAI({ apiKey });
  const model = args.options.model ?? DEFAULT_OPENAI_MODEL;
  const imageBase64 = args.data.toString('base64');
  const response = await client.responses.create({
    model,
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

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}
