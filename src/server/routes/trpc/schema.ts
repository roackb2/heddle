import { z } from 'zod';

export const sessionInputSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
});

export const createSessionInputSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  retention: z.enum(['reusable', 'one_off']).optional(),
  apiKeyPresent: z.boolean().optional(),
}).optional();

export const sessionMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
  maxSteps: z.number().int().min(1).max(500).optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  includePlanTool: z.boolean().optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  systemContext: z.string().min(1).optional(),
  memoryMaintenanceMode: z.enum(['background', 'inline', 'none']).optional(),
});

export const sessionEventsInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const agentAskInputSchema = z.object({
  goal: z.string().min(1),
  model: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(500).optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  systemContext: z.string().min(1).optional(),
});

export const turnReviewInputSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
});

export const sessionApprovalDecisionSchema = z.object({
  sessionId: z.string().min(1),
  decision: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('approve'),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('deny'),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('approve_and_remember_project'),
      reason: z.string().optional(),
    }),
  ]),
});

export const sessionSettingsInputSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'ultrahigh']).optional().nullable(),
  driftEnabled: z.boolean().optional(),
});

export const heartbeatRunsInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).optional();

export const heartbeatTaskInputSchema = z.object({
  taskId: z.string().min(1),
});

export const heartbeatTaskCreateInputSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  name: z.string().min(1).optional(),
  task: z.string().min(1),
  enabled: z.boolean().optional(),
  continuationMode: z.enum(['operator', 'agent']).optional(),
  intervalMs: z.number().int().min(1_000).max(365 * 24 * 60 * 60_000).optional(),
  defer: z.boolean().optional(),
  model: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(500).optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  systemContext: z.string().min(1).optional(),
});

export const heartbeatTaskUpdateInputSchema = heartbeatTaskCreateInputSchema
  .omit({ id: true, defer: true })
  .extend({
    taskId: z.string().min(1),
    name: z.string().min(1).optional(),
    task: z.string().min(1).optional(),
    model: z.string().min(1).optional().nullable(),
    maxSteps: z.number().int().min(1).max(500).optional().nullable(),
  });

export const heartbeatTaskDetailInputSchema = z.object({
  taskId: z.string().min(1),
  runLimit: z.number().int().min(1).max(100).optional(),
});

export const heartbeatTaskRunNowInputSchema = z.object({
  taskId: z.string().min(1),
  model: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(500).optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  systemContext: z.string().min(1).optional(),
});

export const heartbeatRunInputSchema = z.object({
  taskId: z.string().min(1),
  runId: z.string().min(1),
});

export const fileSearchInputSchema = z.object({
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).optional();

export const workspaceBrowseInputSchema = z.object({
  path: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(300).optional(),
  includeHidden: z.boolean().optional(),
}).optional();

export const workspaceFileDiffInputSchema = z.object({
  path: z.string().min(1),
});

export const memoryListInputSchema = z.object({
  path: z.string().min(1).optional(),
}).optional();

export const memoryReadInputSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  maxLines: z.number().int().min(1).max(1000).optional(),
});

export const memorySearchInputSchema = z.object({
  query: z.string().min(1).max(200),
  path: z.string().min(1).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
});

export const layoutSnapshotInputSchema = z.object({
  snapshot: z.unknown(),
});

export const workspaceSetActiveInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const workspaceCreateInputSchema = z.object({
  name: z.string().min(1),
  anchorRoot: z.string().min(1),
  repoRoots: z.array(z.string().min(1)).optional(),
  setActive: z.boolean().optional(),
});

export const workspaceRenameInputSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
});
