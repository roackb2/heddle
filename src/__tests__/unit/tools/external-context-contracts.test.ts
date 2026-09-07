import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ToolInput, ToolOutput } from '@/core/types.js';
import {
  createWebSearchTool,
  type WebSearchToolDefinition,
} from '@/core/tools/toolkits/external-context/web-search.js';
import {
  createViewImageTool,
  type ViewImageToolDefinition,
} from '@/core/tools/toolkits/external-context/view-image.js';
import {
  MAX_EXTERNAL_CONTEXT_PROMPT_LENGTH,
  MAX_VIEW_IMAGE_INPUTS,
  MAX_WEB_SEARCH_CITATIONS,
  ViewImageInputSchema,
  ViewImageOutputSchema,
  WebSearchInputSchema,
  WebSearchOutputSchema,
  type ViewImageInput,
  type ViewImageOutput,
  type WebSearchInput,
  type WebSearchOutput,
} from '@/core/tools/toolkits/external-context/schemas.js';

describe('external-context public contracts', () => {
  it('preserves built-in input and output types through ToolDefinition', () => {
    expectTypeOf<ToolInput<WebSearchToolDefinition>>().toEqualTypeOf<WebSearchInput>();
    expectTypeOf<ToolOutput<WebSearchToolDefinition>>().toEqualTypeOf<WebSearchOutput>();
    expectTypeOf<ToolInput<ViewImageToolDefinition>>().toEqualTypeOf<ViewImageInput>();
    expectTypeOf<ToolOutput<ViewImageToolDefinition>>().toEqualTypeOf<ViewImageOutput>();
  });

  it('publishes the exact schemas used by each tool definition', () => {
    const search = createWebSearchTool();
    const image = createViewImageTool();

    expect(search.inputSchema).toBe(WebSearchInputSchema);
    expect(search.outputSchema).toBe(WebSearchOutputSchema);
    expect(image.inputSchema).toBe(ViewImageInputSchema);
    expect(image.outputSchema).toBe(ViewImageOutputSchema);
  });

  it('validates and normalizes bounded web search inputs', () => {
    expect(WebSearchInputSchema.parse({
      query: '  current runtime docs  ',
      contextSize: 'high',
    })).toEqual({
      query: 'current runtime docs',
      contextSize: 'high',
    });
    expect(WebSearchInputSchema.safeParse({
      query: 'x'.repeat(MAX_EXTERNAL_CONTEXT_PROMPT_LENGTH + 1),
    }).success).toBe(false);
    expect(WebSearchInputSchema.safeParse({ query: 'docs', unexpected: true }).success).toBe(false);
    expect(WebSearchOutputSchema.safeParse({
      provider: 'openai',
      model: 'gpt-test',
      summary: 'summary',
      citations: [{ title: 'unsafe', url: 'javascript:alert(1)' }],
    }).success).toBe(false);
  });

  it('bounds web search citations and image inputs in the canonical schemas', () => {
    const citation = { title: 'Heddle', url: 'https://heddleagent.com' };
    expect(WebSearchOutputSchema.safeParse({
      provider: 'openai',
      model: 'gpt-test',
      summary: 'summary',
      citations: Array.from({ length: MAX_WEB_SEARCH_CITATIONS + 1 }, () => citation),
    }).success).toBe(false);
    expect(ViewImageInputSchema.safeParse({
      references: Array.from({ length: MAX_VIEW_IMAGE_INPUTS + 1 }, (_, index) => `image-${index}`),
    }).success).toBe(false);
    expect(ViewImageInputSchema.safeParse({ prompt: 'no image' }).success).toBe(false);
    expect(ViewImageOutputSchema.safeParse({
      provider: 'openai',
      model: 'gpt-test',
      summary: 'summary',
    }).success).toBe(false);
  });
});
