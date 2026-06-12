/**
 * Custom-agent control-plane smoke harness.
 *
 * Starts an isolated control-plane server, submits a fake ask-mode turn through
 * the real tRPC session API, and verifies that the selected custom-agent
 * snapshot is visible on the completed turn.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientSharedProxyApiService } from '../src/client-shared/api/proxy.js';
import { ControlPlaneSessionApiService } from '../src/cli-v2/services/sessions/control-plane-session-api-service.js';
import { createServerLogger, startHeddleControlPlaneServer } from '../src/server/index.js';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'heddle-custom-agents-smoke-'));
const workspaceRoot = join(fixtureRoot, 'workspace');
const homeRoot = join(fixtureRoot, 'home');
const stateRoot = join(workspaceRoot, '.heddle');

process.env.HOME = homeRoot;
process.env.HEDDLE_BROWSER_INTEGRATION_FAKE_AGENT = '1';

mkdirSync(workspaceRoot, { recursive: true });
mkdirSync(homeRoot, { recursive: true });
writeFileSync(
  join(workspaceRoot, 'README.md'),
  '# Custom Agent Smoke\n\nThis fixture verifies custom-agent control-plane submission.\n',
  'utf8',
);
writeFileSync(
  join(workspaceRoot, 'package.json'),
  `${JSON.stringify({ name: 'custom-agent-smoke', private: true }, null, 2)}\n`,
  'utf8',
);

const server = await startHeddleControlPlaneServer({
  mode: 'embedded-chat',
  workspaceRoot,
  stateRoot,
  preferApiKey: true,
  heartbeatScheduler: { enabled: false },
  host: '127.0.0.1',
  port: 0,
  serveAssets: false,
  daemonRegistryPath: join(stateRoot, 'daemon-registry.json'),
  logger: createServerLogger({ stateRoot, console: false }),
});

try {
  const client = ClientSharedProxyApiService.createClient({
    url: `http://${server.host}:${server.port}/trpc`,
  });
  const sessionApi = new ControlPlaneSessionApiService({
    client,
    defaultModel: 'gpt-5.4',
    maxSteps: 3,
  });
  const workspaceId = await sessionApi.resolveWorkspaceId();
  const catalog = await client.controlPlane.customAgents.query({ workspaceId });
  assert(
    catalog.agents.some((agent) => agent.id === 'builtin:ask' && agent.modeAlias === 'ask'),
    'customAgents route did not expose builtin:ask',
  );

  const session = await sessionApi.createSession(workspaceId, {
    suggestedName: 'Custom Agent Smoke',
    retention: 'reusable',
  });
  const result = await sessionApi.sendPrompt({
    workspaceId,
    sessionId: session.id,
    prompt: 'Verify ask custom-agent turn-scoped selection.',
    agentProfileId: 'builtin:ask',
    includePlanTool: false,
    memoryMaintenanceMode: 'inline',
  });
  const turn = result.session?.turns.at(-1);

  assert.equal(result.outcome, 'done');
  assert.equal(turn?.agent?.id, 'builtin:ask');
  assert.equal(turn?.agent?.name, 'Ask');
  assert.equal(
    turn?.summary,
    'Mocked browser integration agent response: Verify ask custom-agent turn-scoped selection.',
  );

  process.stdout.write([
    'Custom-agent smoke passed.',
    `workspaceId=${workspaceId}`,
    `sessionId=${result.session?.id ?? session.id}`,
    `agent=${turn?.agent?.name ?? 'unknown'}`,
    `response=${turn?.summary ?? 'unknown'}`,
  ].join('\n'));
  process.stdout.write('\n');
} finally {
  await server.close();
  rmSync(fixtureRoot, { recursive: true, force: true });
}
