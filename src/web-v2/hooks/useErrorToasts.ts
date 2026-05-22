import { useEffect, useRef } from 'react';
import { toast } from '@web/components/ui/use-toast';

type ErrorToastSource = {
  key: string;
  title: string;
  error: unknown;
  formatError?: (error: unknown) => string | undefined;
};

export function useErrorToasts(sources: ErrorToastSource[]) {
  const lastMessageByKey = useRef(new Map<string, string>());

  useEffect(() => {
    sources.forEach((source) => {
      const message = (source.formatError ?? defaultFormatError)(source.error);
      if (!message) {
        lastMessageByKey.current.delete(source.key);
        return;
      }

      if (lastMessageByKey.current.get(source.key) === message) {
        return;
      }

      toast({
        title: source.title,
        body: message,
        tone: 'error',
      });
      lastMessageByKey.current.set(source.key, message);
    });
  }, [sources]);
}

function defaultFormatError(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }

  return error instanceof Error ? error.message : String(error);
}
