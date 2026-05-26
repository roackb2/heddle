import { z } from 'zod';

export const sessionInputSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
});

export const sessionRenameInputSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  name: z.string().min(1),
});

export const sessionCompactInputSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  force: z.boolean().optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  systemContext: z.string().min(1).optional(),
});

export const sessionsInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
}).optional();

export const sessionsEventsInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
}).optional();

export const createSessionInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  retention: z.enum(['reusable', 'one_off']).optional(),
  apiKeyPresent: z.boolean().optional(),
}).optional();

export const sessionMessageInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
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
  workspaceId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
});

export const agentAskInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  goal: z.string().min(1),
  model: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(500).optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  systemContext: z.string().min(1).optional(),
});

export const turnReviewInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
});

export const sessionApprovalDecisionSchema = z.object({
  workspaceId: z.string().min(1).optional(),
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
  workspaceId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'ultrahigh']).optional().nullable(),
  driftEnabled: z.boolean().optional(),
});

export const heartbeatRunsInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).optional();

export const heartbeatTaskInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  taskId: z.string().min(1),
});

export const heartbeatTaskCreateInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
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
  workspaceId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  runLimit: z.number().int().min(1).max(100).optional(),
});

export const heartbeatTaskRunNowInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  model: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).max(500).optional(),
  apiKey: z.string().min(1).optional(),
  preferApiKey: z.boolean().optional(),
  searchIgnoreDirs: z.array(z.string().min(1)).optional(),
  systemContext: z.string().min(1).optional(),
});

export const heartbeatRunInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  runId: z.string().min(1),
});

export const fileSearchInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).optional();

export const workspaceBrowseInputSchema = z.object({
  path: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(300).optional(),
  includeHidden: z.boolean().optional(),
}).optional();

export const workspaceFileDiffInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  path: z.string().min(1),
});

export const workspaceScopedInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
}).optional();

export const memoryListInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
}).optional();

export const memoryReadInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  path: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  maxLines: z.number().int().min(1).max(1000).optional(),
});

export const memorySearchInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  query: z.string().min(1).max(200),
  path: z.string().min(1).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
});

export const layoutSnapshotInputSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  snapshot: z.unknown(),
});

export const workspaceSetActiveInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const workspaceCreateInputSchema = z.object({
  name: z.string().min(1),
  workspaceRoot: z.string().min(1),
  repoRoots: z.array(z.string().min(1)).optional(),
  setActive: z.boolean().optional(),
});

export const workspaceRenameInputSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
});
