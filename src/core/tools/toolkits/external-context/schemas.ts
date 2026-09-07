import { z } from 'zod';

export const MAX_EXTERNAL_CONTEXT_PROMPT_LENGTH = 2_000;
export const MAX_WEB_SEARCH_CITATIONS = 20;
export const MAX_WEB_SEARCH_CITATION_TITLE_LENGTH = 1_000;
export const MAX_VIEW_IMAGE_INPUTS = 10;

const ExternalContextLocatorSchema = z.string().trim().min(1);

export const WebSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_EXTERNAL_CONTEXT_PROMPT_LENGTH),
  contextSize: z.enum(['low', 'medium', 'high']).optional(),
}).strict();

export const WebSearchCitationSchema = z.object({
  title: z.string().trim().min(1).max(MAX_WEB_SEARCH_CITATION_TITLE_LENGTH),
  url: z.httpUrl(),
}).strict();

export const WebSearchOutputSchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  model: z.string().trim().min(1),
  summary: z.string(),
  citations: z.array(WebSearchCitationSchema).max(MAX_WEB_SEARCH_CITATIONS),
}).strict();

export const ViewImageInputSchema = z.object({
  path: ExternalContextLocatorSchema.optional(),
  paths: z.array(ExternalContextLocatorSchema).min(1).max(MAX_VIEW_IMAGE_INPUTS).optional(),
  reference: ExternalContextLocatorSchema.optional(),
  references: z.array(ExternalContextLocatorSchema).min(1).max(MAX_VIEW_IMAGE_INPUTS).optional(),
  prompt: z.string().trim().max(MAX_EXTERNAL_CONTEXT_PROMPT_LENGTH).optional(),
}).strict().superRefine((input, context) => {
  const inputCount = [
    ...(input.path ? [input.path] : []),
    ...(input.paths ?? []),
    ...(input.reference ? [input.reference] : []),
    ...(input.references ?? []),
  ].length;
  if (inputCount === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Provide at least one image path or reference.',
    });
  }
  if (inputCount > MAX_VIEW_IMAGE_INPUTS) {
    context.addIssue({
      code: 'custom',
      message: `Provide at most ${MAX_VIEW_IMAGE_INPUTS} images.`,
    });
  }
});

export const ViewImageOutputSchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  model: z.string().trim().min(1),
  path: ExternalContextLocatorSchema.optional(),
  paths: z.array(ExternalContextLocatorSchema).min(1).max(MAX_VIEW_IMAGE_INPUTS).optional(),
  reference: ExternalContextLocatorSchema.optional(),
  references: z.array(ExternalContextLocatorSchema).min(1).max(MAX_VIEW_IMAGE_INPUTS).optional(),
  summary: z.string(),
}).strict().superRefine((output, context) => {
  if (!output.path && !output.paths && !output.reference && !output.references) {
    context.addIssue({
      code: 'custom',
      message: 'Image inspection output must identify at least one path or reference.',
    });
  }
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;
export type WebSearchCitation = z.infer<typeof WebSearchCitationSchema>;
export type WebSearchOutput = z.infer<typeof WebSearchOutputSchema>;
export type ViewImageInput = z.infer<typeof ViewImageInputSchema>;
export type ViewImageOutput = z.infer<typeof ViewImageOutputSchema>;
