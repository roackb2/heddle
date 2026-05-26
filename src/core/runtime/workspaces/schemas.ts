/**
 * Zod schemas for runtime workspace catalog persistence.
 *
 * This file is the human-readable JSON contract for `.heddle/workspaces.catalog.json`.
 */
import { z } from 'zod';

export const WorkspaceDescriptorSchema = z.object({
  id: z.string().describe('Stable workspace identifier used by host surfaces and daemon registration.'),
  name: z.string().describe('Human-facing workspace name shown in control-plane workspace lists.'),
  workspaceRoot: z.string().describe('Filesystem root where this workspace stores its .heddle state directory.'),
  repoRoots: z.array(z.string()).describe('Repository roots grouped into this workspace.'),
  stateRoot: z.string().describe('Heddle state directory for this workspace.'),
  createdAt: z.string().describe('Timestamp when this workspace descriptor was created.'),
  updatedAt: z.string().describe('Timestamp when this workspace descriptor was last changed.'),
});

const WorkspaceDescriptorReadSchema = WorkspaceDescriptorSchema.partial().extend({
  // Legacy catalog field retained only so existing v1 catalogs normalize into
  // the workspaceRoot vocabulary on the next save.
  anchorRoot: z.string().optional().catch(undefined),
});

export const WorkspaceCatalogSchema = z.object({
  version: z.literal(1).describe('Workspace catalog format version.'),
  activeWorkspaceId: z.string().describe('Workspace identifier currently selected by host surfaces.'),
  workspaces: z.array(WorkspaceDescriptorSchema).describe('Known workspace descriptors.'),
});

export const WorkspaceCatalogReadSchema = z.object({
  version: z.literal(1).optional().catch(1),
  activeWorkspaceId: z.string().optional().catch(undefined),
  workspaces: z.array(WorkspaceDescriptorReadSchema).optional().catch(undefined),
});
