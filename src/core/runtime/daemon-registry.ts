import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { WorkspaceDescriptor } from './workspaces.js';

export type DaemonOwnerRecord = {
  ownerId: string;
  mode: 'daemon';
  host: string;
  port: number;
  pid: number;
  startedAt: string;
  lastSeenAt: string;
  workspaceRoot: string;
  stateRoot: string;
};

export type RegisteredWorkspaceRecord = {
  workspace: WorkspaceDescriptor;
  owner?: DaemonOwnerRecord;
  updatedAt: string;
};

export type DaemonRegistry = {
  version: 1;
  updatedAt: string;
  workspaces: RegisteredWorkspaceRecord[];
};

export function resolveDaemonRegistryPath(baseDir = join(homedir(), '.heddle')): string {
  return join(resolve(baseDir), 'daemon-registry.json');
}

export function readDaemonRegistry(registryPath: string): DaemonRegistry {
  if (!existsSync(registryPath)) {
    return createEmptyDaemonRegistry();
  }

  const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as Partial<DaemonRegistry>;
  return normalizeDaemonRegistry(parsed);
}

export function saveDaemonRegistry(registryPath: string, registry: DaemonRegistry) {
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export function upsertDaemonWorkspaceRegistration(options: {
  registryPath: string;
  workspaces: WorkspaceDescriptor[];
  owner: Omit<DaemonOwnerRecord, 'lastSeenAt'> & { lastSeenAt?: string };
}): DaemonRegistry {
  const registry = readDaemonRegistry(options.registryPath);
  const now = options.owner.lastSeenAt ?? new Date().toISOString();
  const nextRecords = new Map(
    registry.workspaces.map((record) => [workspaceRecordKey(record.workspace), record] as const),
  );

  for (const workspace of options.workspaces) {
    nextRecords.set(workspaceRecordKey(workspace), {
      workspace,
      owner: {
        ...options.owner,
        lastSeenAt: now,
      },
      updatedAt: now,
    });
  }

  const nextRegistry: DaemonRegistry = {
    version: 1,
    updatedAt: now,
    workspaces: Array.from(nextRecords.values()),
  };
  saveDaemonRegistry(options.registryPath, nextRegistry);
  return nextRegistry;
}

export function clearDaemonWorkspaceRegistration(options: {
  registryPath: string;
  workspaceIds: string[];
  stateRoots?: string[];
  ownerId: string;
}): DaemonRegistry {
  const registry = readDaemonRegistry(options.registryPath);
  const targetIds = new Set(options.workspaceIds);
  const targetStateRoots = new Set((options.stateRoots ?? []).map((stateRoot) => resolve(stateRoot)));
  const now = new Date().toISOString();
  const nextRegistry: DaemonRegistry = {
    version: 1,
    updatedAt: now,
    workspaces: registry.workspaces.map((record) => {
      const matchesWorkspace = targetIds.has(record.workspace.id) || targetStateRoots.has(resolve(record.workspace.stateRoot));
      if (!matchesWorkspace || record.owner?.ownerId !== options.ownerId) {
        return record;
      }

      return {
        ...record,
        owner: undefined,
        updatedAt: now,
      };
    }),
  };
  saveDaemonRegistry(options.registryPath, nextRegistry);
  return nextRegistry;
}

export function readDaemonWorkspaceRegistration(
  registryPath: string,
  workspaceId: string,
  stateRoot?: string,
): RegisteredWorkspaceRecord | null {
  const registry = readDaemonRegistry(registryPath);
  const normalizedStateRoot = stateRoot ? resolve(stateRoot) : undefined;
  return registry.workspaces.find((record) => (
    normalizedStateRoot ? resolve(record.workspace.stateRoot) === normalizedStateRoot : record.workspace.id === workspaceId
  )) ?? null;
}

export function registerKnownWorkspaces(options: {
  registryPath?: string;
  workspaces: WorkspaceDescriptor[];
}): DaemonRegistry {
  const registryPath = options.registryPath ?? resolveDaemonRegistryPath();
  const registry = readDaemonRegistry(registryPath);
  const now = new Date().toISOString();
  const nextRecords = new Map(
    registry.workspaces.map((record) => [workspaceRecordKey(record.workspace), record] as const),
  );

  for (const workspace of options.workspaces) {
    const existing = nextRecords.get(workspaceRecordKey(workspace));
    nextRecords.set(workspaceRecordKey(workspace), {
      workspace,
      owner: existing?.owner,
      updatedAt: now,
    });
  }

  const nextRegistry: DaemonRegistry = {
    version: 1,
    updatedAt: now,
    workspaces: Array.from(nextRecords.values()),
  };
  saveDaemonRegistry(registryPath, nextRegistry);
  return nextRegistry;
}

function createEmptyDaemonRegistry(): DaemonRegistry {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    workspaces: [],
  };
}

function normalizeDaemonRegistry(registry: Partial<DaemonRegistry>): DaemonRegistry {
  const workspaces = Array.isArray(registry.workspaces) ? registry.workspaces.flatMap(normalizeWorkspaceRecord) : [];
  return {
    version: 1,
    updatedAt:
      typeof registry.updatedAt === 'string' && registry.updatedAt.trim() ?
        registry.updatedAt
      : new Date().toISOString(),
    workspaces,
  };
}

function normalizeWorkspaceRecord(record: Partial<RegisteredWorkspaceRecord>): RegisteredWorkspaceRecord[] {
  if (!record.workspace || typeof record.workspace !== 'object') {
    return [];
  }

  return [{
    workspace: record.workspace as WorkspaceDescriptor,
    owner: normalizeOwnerRecord(record.owner),
    updatedAt:
      typeof record.updatedAt === 'string' && record.updatedAt.trim() ?
        record.updatedAt
      : new Date().toISOString(),
  }];
}

function workspaceRecordKey(workspace: WorkspaceDescriptor): string {
  return resolve(workspace.stateRoot);
}

function normalizeOwnerRecord(owner: unknown): DaemonOwnerRecord | undefined {
  if (!owner || typeof owner !== 'object') {
    return undefined;
  }

  const candidate = owner as Partial<DaemonOwnerRecord>;
  if (
    typeof candidate.ownerId !== 'string'
    || typeof candidate.host !== 'string'
    || typeof candidate.port !== 'number'
    || typeof candidate.startedAt !== 'string'
    || typeof candidate.lastSeenAt !== 'string'
    || typeof candidate.workspaceRoot !== 'string'
    || typeof candidate.stateRoot !== 'string'
  ) {
    return undefined;
  }

  return {
    ownerId: candidate.ownerId,
    mode: 'daemon',
    host: candidate.host,
    port: candidate.port,
    pid: typeof candidate.pid === 'number' ? candidate.pid : 0,
    startedAt: candidate.startedAt,
    lastSeenAt: candidate.lastSeenAt,
    workspaceRoot: candidate.workspaceRoot,
    stateRoot: candidate.stateRoot,
  };
}
