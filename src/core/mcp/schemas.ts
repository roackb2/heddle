import { z } from 'zod';

const McpToolApprovalModeSchema = z.enum(['always', 'never']);

const McpToolPolicySchema = z.object({
  allow: z.array(z.string().min(1)).optional(),
  deny: z.array(z.string().min(1)).optional(),
  approval: McpToolApprovalModeSchema.optional(),
}).passthrough();

const McpRawServerSchema = z.object({
  type: z.enum(['stdio', 'http', 'streamable-http', 'sse']).optional(),
  transport: z.enum(['stdio', 'http', 'streamable-http', 'sse']).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  tools: McpToolPolicySchema.optional(),
}).passthrough();

const McpRawConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpRawServerSchema).optional(),
  servers: z.record(z.string(), McpRawServerSchema).optional(),
}).passthrough();

const McpServerActivationStatusSchema = z.enum(['enabled', 'disabled']);

const McpServerActivationRecordSchema = z.object({
  serverId: z.string().min(1),
  status: McpServerActivationStatusSchema,
  activatedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const McpActivationStoreSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), McpServerActivationRecordSchema),
});

const McpToolDescriptorSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z.record(z.string(), z.unknown()).optional(),
});

const McpServerCatalogRecordSchema = z.object({
  serverId: z.string().min(1),
  protocolVersion: z.string().optional(),
  serverName: z.string().optional(),
  serverVersion: z.string().optional(),
  instructions: z.string().optional(),
  tools: z.array(McpToolDescriptorSchema),
  refreshedAt: z.string().min(1),
});

const McpCatalogStoreSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), McpServerCatalogRecordSchema),
});

export const McpSchemas = {
  parseRawConfig(input: unknown) {
    return McpRawConfigSchema.parse(input);
  },

  parseActivationStore(input: unknown) {
    return McpActivationStoreSchema.parse(input);
  },

  emptyActivationStore() {
    return {
      version: 1,
      servers: {},
    } as const;
  },

  parseCatalogStore(input: unknown) {
    return McpCatalogStoreSchema.parse(input);
  },

  emptyCatalogStore() {
    return {
      version: 1,
      servers: {},
    } as const;
  },
};

export type McpRawServerConfig = z.infer<typeof McpRawServerSchema>;
