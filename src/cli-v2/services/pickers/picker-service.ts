import type {
  ControlPlaneModelOptions,
  ControlPlaneSessionRuntimeContext,
  ControlPlaneSessionView,
} from '@/client-shared/api/types.js';

export type CliV2ModelPickerItem = ControlPlaneModelOptions['groups'][number]['options'][number];

export type CliV2ReasoningPickerItem = ControlPlaneSessionRuntimeContext['reasoningOptions'][number];

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

  static filterModels(modelOptions: ControlPlaneModelOptions | undefined, query: string | undefined): CliV2ModelPickerItem[] {
    if (query === undefined) {
      return [];
    }

    const normalized = normalize(query);
    const models = modelOptions?.groups.flatMap((group) => group.options) ?? [];
    if (!normalized) {
      return models;
    }

    return models.filter((model) => (
      model.id.toLowerCase().includes(normalized) ||
      (model.label ?? '').toLowerCase().includes(normalized)
    ));
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
      .filter((session) => (
        session.id.toLowerCase().includes(normalized) ||
        session.name.toLowerCase().includes(normalized)
      ))
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

    return options.filter((option) => (
      option.id.toLowerCase().includes(normalized) ||
      option.label.toLowerCase().includes(normalized) ||
      option.description.toLowerCase().includes(normalized)
    ));
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
