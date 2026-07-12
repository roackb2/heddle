export type HostedAgentBrowserStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

/** Resolves browser storage without assuming the browser permits access. */
export function resolveHostedAgentBrowserStorage(): HostedAgentBrowserStorage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
