import { z } from 'zod';

// Preserve every Claude block and any provider-added fields. Thinking
// signatures and block order must survive tool-result replay unchanged.
export const AnthropicReplayBlocksSchema = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }).passthrough(),
  z.object({ type: z.literal('thinking'), thinking: z.string(), signature: z.string() }).passthrough(),
  z.object({ type: z.literal('redacted_thinking'), data: z.string() }).passthrough(),
]));
