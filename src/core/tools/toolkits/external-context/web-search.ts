// ---------------------------------------------------------------------------
// Tool: web_search
// Host-side web search MVP backed by the active model provider.
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  TextCitation,
  WebSearchTool20250305,
  ToolChoice,
} from '@anthropic-ai/sdk/resources/messages/messages';
import OpenAI from 'openai';
import type { Response, ResponseOutputText, WebSearchTool } from 'openai/resources/responses/responses.js';
import type { ToolDefinition, ToolResult } from '../../../types.js';
import { inferProviderFromModel } from '../../../llm/factory.js';
import {
  createOpenAiOAuthFetch,
  executeOpenAiOAuthCodexSse,
  extractOpenAiCodexOutputTextFromSse,
  extractOpenAiCodexSseItems,
} from '../../../llm/openai.js';
import { validateModelCredentialCompatibility } from '../../../llm/model-policy.js';
import type { LlmProvider } from '../../../llm/types.js';
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from '../../../config.js';
import {
  resolveOAuthCredentialForModel,
  type ProviderCredentialSource,
} from '../../../runtime/api-keys.js';

type WebSearchInput = {
  query: string;
  contextSize?: 'low' | 'medium' | 'high';
};

export type WebSearchToolOptions = {
  model?: string;
  provider?: LlmProvider;
  apiKey?: string;
  providerCredentialSource?: ProviderCredentialSource;
  credentialStorePath?: string;
};

export const webSearchTool: ToolDefinition = createWebSearchTool();

export function createWebSearchTool(options: WebSearchToolOptions = {}): ToolDefinition {
  return {
    name: 'web_search',
    description:
      'Search the public web when repository files, docs, and local tools are not enough to answer the user. This MVP tool is backed by the active model provider\'s hosted web search when available. Use it for current external facts, official product docs outside the repo, news, releases, APIs, or references that are not available locally. Do not use it for questions the workspace can already answer. Input example: { "query": "OpenAI Responses API web search tool" }. Optional field: contextSize ("low", "medium", or "high"). Returns a concise summary plus cited source URLs when available.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'The web search query.',
        },
        contextSize: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'How much search context to request from the hosted search tool. Defaults to "medium".',
        },
      },
      required: ['query'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      if (!isWebSearchInput(raw)) {
        return {
          ok: false,
          error: 'Invalid input for web_search. Required field: query. Optional field: contextSize ("low", "medium", or "high").',
        };
      }

      const input = raw as WebSearchInput;
      const provider = options.provider ?? inferProviderFromModel(options.model ?? DEFAULT_OPENAI_MODEL);

      try {
        switch (provider) {
          case 'openai':
            return await executeOpenAiWebSearch(input, options);
          case 'anthropic':
            return await executeAnthropicWebSearch(input, options);
          case 'google':
            return {
              ok: false,
              error: 'web_search is not wired for Google models yet.',
            };
        }
      } catch (error) {
        return {
          ok: false,
          error: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

async function executeOpenAiWebSearch(input: WebSearchInput, options: WebSearchToolOptions): Promise<ToolResult> {
  const model = options.model ?? process.env.OPENAI_WEB_SEARCH_MODEL ?? DEFAULT_OPENAI_MODEL;
  const oauthCredential =
    options.providerCredentialSource?.type === 'oauth' ?
      resolveOAuthCredentialForModel(model, { storePath: options.credentialStorePath })
    : undefined;

  if (options.providerCredentialSource?.type === 'oauth' && !oauthCredential) {
    return {
      ok: false,
      error: 'web_search could not load the stored OpenAI account sign-in credential for this workspace. Sign in again with `heddle auth login openai`, or set OPENAI_API_KEY to use Platform API-key mode.',
    };
  }

  const compatibility = validateModelCredentialCompatibility({
    model,
    provider: 'openai',
    credentialMode: oauthCredential ? 'oauth' : undefined,
    usageLabel: 'web search',
  });
  if (!compatibility.ok) {
    return {
      ok: false,
      error: compatibility.error,
    };
  }

  if (oauthCredential) {
    return await executeOpenAiOAuthWebSearch(input, { ...options, model }, oauthCredential);
  }

  const apiKey = firstDefinedNonEmpty(options.apiKey, process.env.OPENAI_API_KEY, process.env.PERSONAL_OPENAI_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      error: 'web_search requires OPENAI_API_KEY (or PERSONAL_OPENAI_API_KEY) when the active model provider is OpenAI.',
    };
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model,
    input: input.query,
    tools: [{
      type: 'web_search_preview',
      search_context_size: input.contextSize ?? 'medium',
    } satisfies WebSearchTool],
  });

  return {
    ok: true,
    output: formatOpenAiWebSearchResult(response),
  };
}

async function executeOpenAiOAuthWebSearch(
  input: WebSearchInput,
  options: WebSearchToolOptions & { model: string },
  oauthCredential: NonNullable<ReturnType<typeof resolveOAuthCredentialForModel>>,
): Promise<ToolResult> {
  const oauthFetch = createOpenAiOAuthFetch(oauthCredential, { storePath: options.credentialStorePath });
  const sseText = await executeOpenAiOAuthCodexSse({
    oauthFetch,
    body: {
      model: options.model,
      store: false,
      stream: true,
      reasoning: { summary: 'auto' },
      instructions: 'Search the web and answer concisely with citations when available.',
      include: ['web_search_call.action.sources'],
      input: [{ type: 'message', role: 'user', content: input.query }],
      tools: [{
        type: 'web_search',
        search_context_size: input.contextSize ?? 'medium',
      }],
    },
  });
  return {
    ok: true,
    output: formatOpenAiOAuthWebSearchSseResult(sseText, options.model),
  };
}

async function executeAnthropicWebSearch(input: WebSearchInput, options: WebSearchToolOptions): Promise<ToolResult> {
  const apiKey = firstDefinedNonEmpty(options.apiKey, process.env.ANTHROPIC_API_KEY, process.env.PERSONAL_ANTHROPIC_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      error: 'web_search requires ANTHROPIC_API_KEY (or PERSONAL_ANTHROPIC_API_KEY) when the active model provider is Anthropic.',
    };
  }

  const client = new Anthropic({ apiKey });
  const model = options.model ?? process.env.ANTHROPIC_WEB_SEARCH_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const toolChoice: ToolChoice = { type: 'tool', name: 'web_search' };
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    tool_choice: toolChoice,
    tools: [{
      name: 'web_search',
      type: 'web_search_20250305',
      max_uses: 1,
    } satisfies WebSearchTool20250305],
    messages: [{
      role: 'user',
      content: `Search the web for the following query and answer concisely with citations when available:\n\n${input.query}`,
    }],
  });

  return {
    ok: true,
    output: formatAnthropicWebSearchResult(response),
  };
}

function firstDefinedNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}

function isWebSearchInput(raw: unknown): raw is WebSearchInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const input = raw as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== 'query' && key !== 'contextSize')) {
    return false;
  }

  if (typeof input.query !== 'string' || input.query.trim().length === 0) {
    return false;
  }

  return input.contextSize === undefined || input.contextSize === 'low' || input.contextSize === 'medium' || input.contextSize === 'high';
}

function formatOpenAiWebSearchResult(response: Response): {
  provider: 'openai';
  model: string;
  summary: string;
  citations: Array<{ title: string; url: string }>;
} {
  const summary = response.output_text?.trim() || 'No summary returned.';
  const citations = extractOpenAiUrlCitations(response);

  return {
    provider: 'openai',
    model: response.model,
    summary,
    citations,
  };
}

function extractOpenAiUrlCitations(response: Response): Array<{ title: string; url: string }> {
  const outputItems = response.output ?? [];
  const citations: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  for (const item of outputItems) {
    if (item.type !== 'message') {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type !== 'output_text') {
        continue;
      }

      for (const annotation of (content as ResponseOutputText).annotations ?? []) {
        if (annotation.type !== 'url_citation') {
          continue;
        }

        const key = `${annotation.title}|${annotation.url}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        citations.push({
          title: annotation.title,
          url: annotation.url,
        });
      }
    }
  }

  return citations;
}

function formatOpenAiOAuthWebSearchSseResult(sseText: string, model: string): {
  provider: 'openai';
  model: string;
  summary: string;
  citations: Array<{ title: string; url: string }>;
} {
  return {
    provider: 'openai',
    model,
    summary: extractOpenAiCodexOutputTextFromSse(sseText).trim() || 'No summary returned.',
    citations: extractSseWebSearchSources(sseText),
  };
}

function extractSseWebSearchSources(sseText: string): Array<{ title: string; url: string }> {
  const citations: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  const items = extractOpenAiCodexSseItems<{
    type: 'web_search_call';
    action?: { sources?: Array<{ type?: string; url?: string }> };
  }>(
    sseText,
    (item): item is { type: 'web_search_call'; action?: { sources?: Array<{ type?: string; url?: string }> } } =>
      Boolean(item && typeof item === 'object' && (item as { type?: unknown }).type === 'web_search_call'),
  );

  for (const item of items) {
    for (const source of item.action?.sources ?? []) {
      if (source.type !== 'url' || !source.url) {
        continue;
      }
      if (seen.has(source.url)) {
        continue;
      }
      seen.add(source.url);
      citations.push({
        title: source.url,
        url: source.url,
      });
    }
  }

  return citations;
}

function formatAnthropicWebSearchResult(response: Message): {
  provider: 'anthropic';
  model: string;
  summary: string;
  citations: Array<{ title: string; url: string }>;
} {
  const textBlocks = response.content.filter((block): block is Extract<Message['content'][number], { type: 'text' }> => block.type === 'text');
  const summary = textBlocks.map((block) => block.text).join('\n').trim() || 'No summary returned.';
  const citations = extractAnthropicUrlCitations(textBlocks.flatMap((block) => block.citations ?? []));

  return {
    provider: 'anthropic',
    model: response.model,
    summary,
    citations,
  };
}

function extractAnthropicUrlCitations(citationsInput: TextCitation[]): Array<{ title: string; url: string }> {
  const citations: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  for (const citation of citationsInput) {
    if (citation.type !== 'web_search_result_location') {
      continue;
    }

    if (!citation.url) {
      continue;
    }

    const title = citation.title ?? citation.url;
    const key = `${title}|${citation.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    citations.push({
      title,
      url: citation.url,
    });
  }

  return citations;
}
