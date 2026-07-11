/**
 * Stage 05.2 runner: expose the stage-1 service through Express and SSE.
 *
 * This stage assumes the host chose this transport stack. Authentication,
 * routing, tenancy, and deployment remain host responsibilities.
 * Run: HEDDLE_EXAMPLE_BEARER_TOKEN=local-example-secret yarn example:sdk:hosted-api
 */
import { timingSafeEqual } from 'node:crypto';
import express, { type Request } from 'express';
import {
  EXAMPLE_ACCOUNT_ID,
  createExampleHostedAgentService,
} from '../01-hosted-service/example-agent.js';
import {
  HostedAgentApiError,
  createHostedAgentApiRouter,
} from './http-api.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The hosted-agent demo authentication adapter refuses to run in production.');
}

const bearerToken = process.env.HEDDLE_EXAMPLE_BEARER_TOKEN;
if (!bearerToken || bearerToken.length < 16) {
  throw new Error('Set HEDDLE_EXAMPLE_BEARER_TOKEN to an explicit secret of at least 16 characters.');
}

const port = parsePort(process.env.HEDDLE_EXAMPLE_PORT ?? '8787');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api/agent', createHostedAgentApiRouter({
  agent: createExampleHostedAgentService(),
  authenticate: async (request) => authenticateBearer(request, bearerToken),
  onError: (error) => console.error('Hosted agent API error:', error),
}));

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Hosted agent API listening at http://127.0.0.1:${port}/api/agent.`);
  console.log('Run `yarn example:sdk:browser-client "your prompt"` in another terminal.');
});

const shutdown = () => server.close();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function authenticateBearer(request: Request, expectedToken: string): { accountId: string } {
  const authorization = request.header('authorization');
  const providedToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new HostedAgentApiError(401, 'unauthorized', 'A valid example bearer token is required.');
  }
  return { accountId: EXAMPLE_ACCOUNT_ID };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('HEDDLE_EXAMPLE_PORT must be an integer between 1 and 65535.');
  }
  return port;
}
