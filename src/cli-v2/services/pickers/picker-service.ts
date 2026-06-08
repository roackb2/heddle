import type {
  ControlPlaneModelOptions,
  ControlPlaneSessionRuntimeContext,
  ControlPlaneSessionView,
} from '@/client-shared/api/types.js';

export type CliV2ModelPickerItem = ControlPlaneModelOptions['groups'][number]['options'][number];

export type CliV2ReasoningPickerItem = ControlPlaneSessionRuntimeContext['reasoningOptions'][number];

export type CliV2PermissionModePickerItem = ControlPlaneSessionRuntimeContext['permissionModeOptions'][number];

export type CliV2SessionPickerItem = Pick<ControlPlaneSessionView, 'id' | 'name'>;

export class CliV2PickerService {
  static modelQuery(draft: string): string | undefined {
    return queryAfterPrefix(draft, '/model set');
  }

  static sessionQuery(draft: string): string | undefined {
    return queryAfterPrefix(draft, '/session choose');
  }

  static reasoningQuery(draft: string): string | undefined {
    return queryAfterPrefix(draft, '/reasoning set');
  }

  static permissionModeQuery(draft: string): string | undefined {
    return queryAfterPrefix(draft, '/permissions set');
  }

  static filterModels(modelOptions: ControlPlaneModelOptions | undefined, query: string | undefined): CliV2ModelPickerItem[] {
    if (query === undefined) {
      return [];
    }

    const normalized = normalize(query);
    const models = modelOptions?.groups.flatMap((group) => group.options) ?? [];
    if (!normalized) {
      return models;
    }

    return models.filter((model) => matchesNormalizedQuery([model.id, model.label], normalized));
  }

  static filterSessions(sessions: ControlPlaneSessionView[], query: string | undefined): CliV2SessionPickerItem[] {
    if (query === undefined) {
      return [];
    }

    const normalized = normalize(query);
    if (!normalized) {
      return sessions.map(({ id, name }) => ({ id, name }));
    }

    return sessions
      .filter((session) => matchesNormalizedQuery([session.id, session.name], normalized))
      .map(({ id, name }) => ({ id, name }));
  }

  static filterReasoningOptions(
    runtimeContext: ControlPlaneSessionRuntimeContext | undefined,
    query: string | undefined,
  ): CliV2ReasoningPickerItem[] {
    if (query === undefined) {
      return [];
    }

    const normalized = normalize(query);
    const options = runtimeContext?.reasoningOptions ?? [];
    if (!normalized) {
      return options;
    }

    return options.filter((option) => matchesNormalizedQuery([
      option.id,
      option.label,
      option.description,
    ], normalized));
  }

  static filterPermissionModes(
    runtimeContext: ControlPlaneSessionRuntimeContext | undefined,
    query: string | undefined,
  ): CliV2PermissionModePickerItem[] {
    if (query === undefined) {
      return [];
    }

    const normalized = normalize(query);
    const options = runtimeContext?.permissionModeOptions ?? [];
    if (!normalized) {
      return options;
    }

    return options.filter((option) => matchesNormalizedQuery([
      option.id,
      option.label,
      option.description,
      option.disabledReason,
    ], normalized));
  }

  static permissionModeInitialIndex(
    runtimeContext: ControlPlaneSessionRuntimeContext | undefined,
    query: string | undefined,
  ): number {
    const options = CliV2PickerService.filterPermissionModes(runtimeContext, query);
    const activePermissionMode = runtimeContext?.permissionMode ?? 'default';
    return Math.max(0, options.findIndex((option) => option.id === activePermissionMode));
  }

  static clampIndex(index: number, itemCount: number): number {
    return itemCount === 0 ? 0 : Math.min(index, Math.max(0, itemCount - 1));
  }

  static nextIndex(index: number, itemCount: number): number {
    return itemCount === 0 ? 0 : (index + 1) % itemCount;
  }

  static previousIndex(index: number, itemCount: number): number {
    return itemCount === 0 ? 0 : index <= 0 ? itemCount - 1 : index - 1;
  }
}

function queryAfterPrefix(draft: string, prefix: string): string | undefined {
  const trimmedStart = draft.trimStart();
  if (!trimmedStart.startsWith(prefix)) {
    return undefined;
  }

  return trimmedStart.slice(prefix.length).trim();
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matchesNormalizedQuery(values: Array<string | undefined>, normalizedQuery: string): boolean {
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery) ?? false);
}
