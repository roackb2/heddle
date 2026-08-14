import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  JoseExecutionAuthority,
} from '@heddleagent/execution-host-client/authority';
import {
  HostedConversationTurnService,
} from '@heddleagent/execution-host-client/conversation';
import {
  generateEphemeralExecutionAuthorityKeyPair,
  NodeExecutionAdopterHttpService,
} from '@heddleagent/execution-host-client/node';
import {
  LocalExecutionHostContractFixture,
} from '@heddleagent/execution-host-client/testing';

const keyPair = await generateEphemeralExecutionAuthorityKeyPair();
const authority = await JoseExecutionAuthority.create({
  issuer: 'http://127.0.0.1:3000',
  adopterId: 'example-product',
  executionAudience: 'urn:heddle-execution-host:local',
  keyId: 'local-example-key',
  executionTtlSeconds: 300,
}, keyPair);
const executionHost = await LocalExecutionHostContractFixture.start({
  execute: async () => ({
    kind: 'result',
    result: {
      outcome: 'done',
      summary: 'The local adopter contract completed.',
    },
  }),
});
const hostedTurns = new HostedConversationTurnService({
  authority,
  executionHost: executionHost.createExecutionHost(),
  modelCredentials: {
    resolveModelApiKey: async () => 'local-model-api-key',
  },
});
const httpEdge = new NodeExecutionAdopterHttpService({
  authority,
  authenticator: {
    authenticate: ({ authorization }) => authorization === 'Bearer local-user'
      ? { subjectId: 'user-001' }
      : undefined,
  },
  conversations: {
    streamTurn: ({ principal, prompt, signal }) => hostedTurns.streamTurn({
      scope: {
        tenantId: 'tenant-001',
        subjectId: principal.subjectId,
        productSessionId: 'conversation-001',
      },
      runtimeSessionId: 'runtime-session-001-abcdefghijklmnop',
      invocationId: 'invocation-001',
      prompt,
      signal,
    }),
  },
});
const server = createServer((request, response) => {
  if (!httpEdge.handle(request, response)) {
    response.writeHead(404).end();
  }
});

try {
  await listen(server);
  const address = server.address() as AddressInfo;
  const response = await fetch(
    `http://127.0.0.1:${address.port}/hosted-execution/conversation-turns`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local-user',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Run one local contract turn.' }),
    },
  );
  if (!response.ok) {
    throw new Error(`Adopter example failed with HTTP ${response.status}.`);
  }
  const eventKinds = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('event: '))
    .map((line) => line.slice('event: '.length));
  console.log(JSON.stringify({ status: response.status, eventKinds }, null, 2));
} finally {
  await httpEdge.close();
  await executionHost.close();
  await close(server);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
