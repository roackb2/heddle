/**
 * Runtime daemon registry service.
 *
 * Owns the domain behavior for recording known workspaces, claiming daemon
 * ownership, clearing daemon ownership, and resolving workspace registrations.
 */
import { resolve } from 'node:path';
import { DaemonRegistryReadSchema } from './schemas.js';
import { FileDaemonRegistryRepository } from './registry-repository.js';
import type {
  ClearDaemonWorkspaceRegistrationInput,
  DaemonOwnerRecord,
  DaemonRegistry,
  RegisteredWorkspaceRecord,
  RegisterKnownWorkspacesInput,
  UpsertDaemonWorkspaceRegistrationInput,
} from './types.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';

export class RuntimeDaemonRegistryService {
  static read(registryPath: string): DaemonRegistry {
    const repository = new FileDaemonRegistryRepository({ registryPath });
    return RuntimeDaemonRegistryService.normalizeRegistry(repository.readRaw());
  }

  static upsertWorkspaceRegistration(input: UpsertDaemonWorkspaceRegistrationInput): DaemonRegistry {
    const registry = RuntimeDaemonRegistryService.read(input.registryPath);
    const now = input.owner.lastSeenAt ?? new Date().toISOString();
    const nextRecords = RuntimeDaemonRegistryService.toRecordMap(registry.workspaces);

    for (const workspace of input.workspaces) {
      nextRecords.set(RuntimeDaemonRegistryService.workspaceRecordKey(workspace), {
        workspace,
        owner: {
          ...input.owner,
          lastSeenAt: now,
        },
        updatedAt: now,
      });
    }

    return RuntimeDaemonRegistryService.saveNext(input.registryPath, {
      version: 1,
      updatedAt: now,
      workspaces: Array.from(nextRecords.values()),
    });
  }

  static clearWorkspaceRegistration(input: ClearDaemonWorkspaceRegistrationInput): DaemonRegistry {
    const registry = RuntimeDaemonRegistryService.read(input.registryPath);
    const targetIds = new Set(input.workspaceIds);
    const targetStateRoots = new Set((input.stateRoots ?? []).map((stateRoot) => resolve(stateRoot)));
    const now = new Date().toISOString();

    return RuntimeDaemonRegistryService.saveNext(input.registryPath, {
      version: 1,
      updatedAt: now,
      workspaces: registry.workspaces.map((record) => {
        const matchesWorkspace =
          targetIds.has(record.workspace.id)
          || targetStateRoots.has(resolve(record.workspace.stateRoot));
        if (!matchesWorkspace || record.owner?.ownerId !== input.ownerId) {
          return record;
        }

        return {
          ...record,
          owner: undefined,
          updatedAt: now,
        };
      }),
    });
  }

  static readWorkspaceRegistration(
    registryPath: string,
    workspaceId: string,
    stateRoot?: string,
  ): RegisteredWorkspaceRecord | null {
    const registry = RuntimeDaemonRegistryService.read(registryPath);
    const normalizedStateRoot = stateRoot ? resolve(stateRoot) : undefined;
    return registry.workspaces.find((record) => (
      normalizedStateRoot ?
        resolve(record.workspace.stateRoot) === normalizedStateRoot
      : record.workspace.id === workspaceId
    )) ?? null;
  }

  static registerKnownWorkspaces(input: RegisterKnownWorkspacesInput): DaemonRegistry {
    const registryPath = input.registryPath ?? FileDaemonRegistryRepository.resolvePath();
    const registry = RuntimeDaemonRegistryService.read(registryPath);
    const now = new Date().toISOString();
    const nextRecords = RuntimeDaemonRegistryService.toRecordMap(registry.workspaces);

    for (const workspace of input.workspaces) {
      const existing = nextRecords.get(RuntimeDaemonRegistryService.workspaceRecordKey(workspace));
      nextRecords.set(RuntimeDaemonRegistryService.workspaceRecordKey(workspace), {
        workspace,
        owner: existing?.owner,
        updatedAt: now,
      });
    }

    return RuntimeDaemonRegistryService.saveNext(registryPath, {
      version: 1,
      updatedAt: now,
      workspaces: Array.from(nextRecords.values()),
    });
  }

  private static saveNext(registryPath: string, registry: DaemonRegistry): DaemonRegistry {
    new FileDaemonRegistryRepository({ registryPath }).save(registry);
    return registry;
  }

  private static createEmptyRegistry(): DaemonRegistry {
    return {
      version: 1,
      updatedAt: new Date(0).toISOString(),
      workspaces: [],
    };
  }

  private static normalizeRegistry(raw: unknown): DaemonRegistry {
    if (raw === undefined) {
      return RuntimeDaemonRegistryService.createEmptyRegistry();
    }

    const parsed = DaemonRegistryReadSchema.safeParse(raw);
    if (!parsed.success) {
      return RuntimeDaemonRegistryService.createEmptyRegistry();
    }

    return {
      version: 1,
      updatedAt: parsed.data.updatedAt?.trim() || new Date().toISOString(),
      workspaces: (parsed.data.workspaces ?? []).flatMap((record) => (
        record.workspace ? [RuntimeDaemonRegistryService.normalizeWorkspaceRecord(record)] : []
      )),
    };
  }

  private static normalizeWorkspaceRecord(record: {
    workspace?: Partial<WorkspaceDescriptor>;
    owner?: Partial<DaemonOwnerRecord>;
    updatedAt?: string;
  }): RegisteredWorkspaceRecord {
    return {
      workspace: record.workspace as WorkspaceDescriptor,
      owner: RuntimeDaemonRegistryService.normalizeOwner(record.owner),
      updatedAt: record.updatedAt?.trim() || new Date().toISOString(),
    };
  }

  private static normalizeOwner(owner: Partial<DaemonOwnerRecord> | undefined): DaemonOwnerRecord | undefined {
    if (!owner?.ownerId || !owner.host || typeof owner.port !== 'number' || !owner.startedAt || !owner.lastSeenAt) {
      return undefined;
    }

    return {
      ownerId: owner.ownerId,
      mode: 'daemon',
      host: owner.host,
      port: owner.port,
      pid: typeof owner.pid === 'number' ? owner.pid : 0,
      startedAt: owner.startedAt,
      lastSeenAt: owner.lastSeenAt,
      workspaceRoot: owner.workspaceRoot ?? '',
      stateRoot: owner.stateRoot ?? '',
    };
  }

  private static toRecordMap(records: RegisteredWorkspaceRecord[]): Map<string, RegisteredWorkspaceRecord> {
    return new Map(records.map((record) => [
      RuntimeDaemonRegistryService.workspaceRecordKey(record.workspace),
      record,
    ]));
  }

  private static workspaceRecordKey(workspace: WorkspaceDescriptor): string {
    return resolve(workspace.stateRoot);
  }
}
