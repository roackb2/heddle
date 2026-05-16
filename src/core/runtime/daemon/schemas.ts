/**
 * Zod schemas for daemon registry persistence.
 *
 * This file is the JSON contract for `.heddle/daemon-registry.json`, which
 * lets hosts discover live daemon owners for known workspaces.
 */
import { z } from 'zod';
import { WorkspaceDescriptorSchema } from '@/core/runtime/workspaces/schemas.js';

export const DaemonOwnerRecordSchema = z.object({
  ownerId: z.string().describe('Unique daemon owner identifier for this registration.'),
  mode: z.literal('daemon').describe('Runtime owner mode. Currently only daemon owners are persisted here.'),
  host: z.string().describe('HTTP host where the daemon control plane listens.'),
  port: z.number().describe('HTTP port where the daemon control plane listens.'),
  pid: z.number().describe('Local process id for stale-owner detection.'),
  startedAt: z.string().describe('Timestamp when this daemon owner started.'),
  lastSeenAt: z.string().describe('Timestamp when this daemon owner last refreshed its registration.'),
  workspaceRoot: z.string().describe('Filesystem workspace root used by this daemon owner.'),
  stateRoot: z.string().describe('Heddle state root used by this daemon owner.'),
});

export const RegisteredWorkspaceRecordSchema = z.object({
  workspace: WorkspaceDescriptorSchema.describe('Workspace descriptor known to the daemon registry.'),
  owner: DaemonOwnerRecordSchema.optional().catch(undefined)
    .describe('Live daemon owner for this workspace when one is registered.'),
  updatedAt: z.string().describe('Timestamp when this registry record was last changed.'),
});

export const DaemonRegistrySchema = z.object({
  version: z.literal(1).describe('Daemon registry format version.'),
  updatedAt: z.string().describe('Timestamp when this registry was last written.'),
  workspaces: z.array(RegisteredWorkspaceRecordSchema).describe('Known workspace records and optional daemon owners.'),
});

export const DaemonRegistryReadSchema = z.object({
  version: z.literal(1).optional().catch(1),
  updatedAt: z.string().optional().catch(undefined),
  workspaces: z.array(RegisteredWorkspaceRecordSchema.partial()).optional().catch(undefined),
});
