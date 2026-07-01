import { z } from 'zod';
import { ArtifactService } from '@/core/artifacts/index.js';
import { ArtifactKindSchema } from '@/core/artifacts/schemas.js';
import type { ArtifactKind, ArtifactListOptions, RuntimeArtifact } from '@/core/artifacts/index.js';
import type { ToolDefinition, ToolResult } from '@/core/types.js';
import type { ToolToolkit } from '../../toolkit.js';

const ARTIFACT_DASHBOARD_NAME = 'artifact_dashboard';
const LIST_ARTIFACTS_NAME = 'list_artifacts';
const READ_ARTIFACT_NAME = 'read_artifact';
const SAVE_ARTIFACT_NAME = 'save_artifact';
const SET_CURRENT_ARTIFACT_NAME = 'set_current_artifact';

const ArtifactScopeSchema = z.enum(['current-session', 'workspace', 'all']).default('current-session');

const ArtifactListInputSchema = z.object({
  scope: ArtifactScopeSchema,
  domain: z.string().min(1).optional(),
  kind: ArtifactKindSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
}).partial().default({});

const ArtifactReadInputSchema = z.object({
  id: z.string().min(1).optional(),
  current: z.boolean().optional(),
}).default({});

const SaveArtifactInputSchema = z.object({
  content: z.string(),
  kind: ArtifactKindSchema,
  domain: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  extension: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  setCurrent: z.boolean().optional(),
});

const SetCurrentArtifactInputSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(['current-session', 'workspace']).default('current-session'),
});

export const artifactsToolkit: ToolToolkit = {
  id: 'artifacts',
  createTools(context) {
    const service = new ArtifactService({ artifactRoot: context.artifactRoot });
    const serviceContext = {
      service,
      artifactRoot: context.artifactRoot,
      sessionId: context.sessionId,
    };

    return [
      createArtifactDashboardTool(serviceContext),
      createListArtifactsTool(serviceContext),
      createReadArtifactTool(serviceContext),
      createSaveArtifactTool(serviceContext),
      createSetCurrentArtifactTool(serviceContext),
    ];
  },
};

type ArtifactToolContext = {
  service: ArtifactService;
  artifactRoot: string;
  sessionId?: string;
};

type ToolOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function createArtifactDashboardTool(context: ArtifactToolContext): ToolDefinition {
  return {
    name: ARTIFACT_DASHBOARD_NAME,
    description:
      'Summarize the current artifact and recent saved artifacts for this conversation. Use this before editing or continuing generated files such as decks, documents, HTML previews, JSON outputs, diagrams, or reports.',
    capabilities: ['artifact.read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    async execute(): Promise<ToolResult> {
      const current = context.service.current(context.sessionId);
      const recent = selectArtifacts({
        service: context.service,
        sessionId: context.sessionId,
        scope: 'all',
        limit: 5,
      });

      return {
        ok: true,
        output: {
          current: current ? serializeArtifact(context.artifactRoot, current) : undefined,
          recent: recent.map((artifact) => serializeArtifact(context.artifactRoot, artifact)),
        },
      };
    },
  };
}

function createListArtifactsTool(context: ArtifactToolContext): ToolDefinition {
  return {
    name: LIST_ARTIFACTS_NAME,
    description:
      'List saved artifacts by scope, domain, or kind. Use this to find reusable outputs before reading or editing them.',
    capabilities: ['artifact.read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: {
          type: 'string',
          enum: ['current-session', 'workspace', 'all'],
          description: 'current-session lists artifacts for this chat session, workspace lists workspace-level artifacts, all lists both.',
        },
        domain: { type: 'string', description: 'Optional domain filter, such as presentation, report, diagram, or dataset.' },
        kind: { type: 'string', enum: ArtifactKindSchema.options, description: 'Optional artifact kind filter.' },
        limit: { type: 'number', minimum: 1, maximum: 50, description: 'Maximum artifacts to return.' },
      },
    },
    async execute(raw: unknown): Promise<ToolResult> {
      const parsed = ArtifactListInputSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }

      const artifacts = selectArtifacts({
        service: context.service,
        sessionId: context.sessionId,
        scope: parsed.data.scope ?? 'current-session',
        domain: parsed.data.domain,
        kind: parsed.data.kind,
        limit: parsed.data.limit ?? 10,
      });

      return {
        ok: true,
        output: {
          artifacts: artifacts.map((artifact) => serializeArtifact(context.artifactRoot, artifact)),
        },
      };
    },
  };
}

function createReadArtifactTool(context: ArtifactToolContext): ToolDefinition {
  return {
    name: READ_ARTIFACT_NAME,
    description:
      'Read the text content of a saved artifact by id, or read the current artifact when no id is provided.',
    capabilities: ['artifact.read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Artifact id. If omitted, the current artifact for this session is read.' },
        current: { type: 'boolean', description: 'Read the current artifact. Defaults to true when id is omitted.' },
      },
    },
    async execute(raw: unknown): Promise<ToolResult> {
      const parsed = ArtifactReadInputSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }

      const artifactId = parsed.data.id ?? context.service.current(context.sessionId)?.id;
      if (!artifactId || (parsed.data.current === false && !parsed.data.id)) {
        return { ok: false, error: 'No artifact id was provided and no current artifact is set for this session.' };
      }

      const result = context.service.read(artifactId);
      if (!result) {
        return { ok: false, error: `Artifact not found or unreadable: ${artifactId}` };
      }

      return {
        ok: true,
        output: {
          artifact: serializeArtifact(context.artifactRoot, result.artifact),
          content: result.content,
        },
      };
    },
  };
}

function createSaveArtifactTool(context: ArtifactToolContext): ToolDefinition {
  return {
    name: SAVE_ARTIFACT_NAME,
    description:
      'Save text content as a reusable artifact for this conversation. Use this for generated source, HTML previews, JSON outputs, documents, diagrams, reports, and other text-like files that should be editable in follow-up turns.',
    capabilities: ['artifact.write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        content: { type: 'string', description: 'Text content to save.' },
        kind: { type: 'string', enum: ArtifactKindSchema.options, description: 'Artifact kind.' },
        domain: { type: 'string', description: 'Optional domain, such as presentation, report, diagram, or dataset.' },
        title: { type: 'string', description: 'Optional human-readable title or filename.' },
        extension: { type: 'string', description: 'Optional file extension without leading dot.' },
        mimeType: { type: 'string', description: 'Optional MIME type.' },
        metadata: { type: 'object', additionalProperties: true, description: 'Optional structured metadata.' },
        setCurrent: { type: 'boolean', description: 'Whether this artifact becomes current for the session. Defaults to true.' },
      },
      required: ['content', 'kind'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      const parsed = SaveArtifactInputSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }

      const result = tryToolOperation(() => context.service.saveText({
        ...parsed.data,
        sessionId: context.sessionId,
        sourceTool: SAVE_ARTIFACT_NAME,
      }));
      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        output: {
          artifact: serializeArtifact(context.artifactRoot, result.value),
        },
      };
    },
  };
}

function createSetCurrentArtifactTool(context: ArtifactToolContext): ToolDefinition {
  return {
    name: SET_CURRENT_ARTIFACT_NAME,
    description:
      'Set an existing artifact as the current artifact for follow-up conversation turns.',
    capabilities: ['artifact.write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Artifact id.' },
        scope: {
          type: 'string',
          enum: ['current-session', 'workspace'],
          description: 'Set current artifact for this session or the workspace.',
        },
      },
      required: ['id'],
    },
    async execute(raw: unknown): Promise<ToolResult> {
      const parsed = SetCurrentArtifactInputSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }

      const result = tryToolOperation(() => context.service.setCurrent(parsed.data.id, {
        sessionId: parsed.data.scope === 'workspace' ? undefined : context.sessionId,
      }));
      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        output: {
          artifact: serializeArtifact(context.artifactRoot, result.value),
        },
      };
    },
  };
}

function selectArtifacts(args: {
  service: ArtifactService;
  sessionId?: string;
  scope: 'current-session' | 'workspace' | 'all';
  domain?: string;
  kind?: ArtifactKind;
  limit: number;
}): RuntimeArtifact[] {
  const baseOptions: ArtifactListOptions = {
    domain: args.domain,
    kind: args.kind,
  };
  const artifacts = args.scope === 'current-session' && args.sessionId
    ? args.service.list({ ...baseOptions, sessionId: args.sessionId })
    : args.service.list(baseOptions).filter((artifact) => {
      if (args.scope === 'workspace') {
        return !artifact.sessionId;
      }

      return true;
    });

  return artifacts.slice(0, args.limit);
}

function serializeArtifact(artifactRoot: string, artifact: RuntimeArtifact): RuntimeArtifact & { relativePath: string } {
  return {
    ...artifact,
    relativePath: ArtifactService.relativeArtifactPath(artifactRoot, artifact),
  };
}

function tryToolOperation<T>(operation: () => T): ToolOperationResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
