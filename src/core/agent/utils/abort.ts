export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return (
    err.name === 'AbortError' ||
    err.name === 'APIUserAbortError' ||
    /aborted/i.test(err.message)
  );
}
