export type SessionModelSyncAction =
  | { kind: 'none' }
  | { kind: 'adopt_session_model'; model: string }
  | { kind: 'persist_active_model' };

export function resolveSessionModelSync(args: {
  previousSessionId?: string;
  currentSessionId?: string;
  currentSessionModel?: string;
  activeModel: string;
}): SessionModelSyncAction {
  if (!args.currentSessionId || !args.currentSessionModel) {
    return { kind: 'none' };
  }

  const sessionChanged = args.previousSessionId !== args.currentSessionId;
  if (sessionChanged) {
    if (args.currentSessionModel !== args.activeModel) {
      return {
        kind: 'adopt_session_model',
        model: args.currentSessionModel,
      };
    }

    return { kind: 'none' };
  }

  if (args.currentSessionModel !== args.activeModel) {
    return { kind: 'persist_active_model' };
  }

  return { kind: 'none' };
}
