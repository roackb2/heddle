import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { readHostedAgentExampleConfiguration } from './configuration.js';
import { HostedAgentUiClient } from './hosted-agent-ui-client.js';
import './styles.css';

const configuration = readHostedAgentExampleConfiguration();
const client = configuration.bearerToken
  ? new HostedAgentUiClient({
    baseUrl: configuration.baseUrl,
    getHeaders: () => ({ Authorization: `Bearer ${configuration.bearerToken}` }),
  })
  : undefined;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});
const root = document.getElementById('root');
if (!root) {
  throw new Error('Hosted agent example root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App client={client} configuration={configuration} />
    </QueryClientProvider>
  </StrictMode>,
);
