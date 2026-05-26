import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { trpcReact, useControlPlaneTrpcClient } from './client';

/**
 * Owns browser API clients for web-v2. Query and subscription hooks should be
 * mounted under this provider instead of creating ad hoc EventSource clients.
 */
export function ControlPlaneApiProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const trpcClient = useControlPlaneTrpcClient();

  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpcReact.Provider>
  );
}
