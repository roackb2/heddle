export function formatApiError(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
}
