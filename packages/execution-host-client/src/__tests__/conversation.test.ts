import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionAuthority,
  ExecutionAuthorityIssueInput,
  IssuedExecutionAuthority,
} from '../authority/index.js';
import type { ExecutionHostConversationTurn } from '../http-sse/index.js';
import {
  HostedConversationConfigurationError,
  HostedConversationTurnService,
} from '../conversation/index.js';
import type { ExecutionHostStreamEvent } from '../contracts/index.js';

describe('hosted conversation turn service', () => {
  it('binds authority, model credentials, MCP policy, and host streaming', async () => {
    let issuedInput: ExecutionAuthorityIssueInput | undefined;
    let hostInput: ExecutionHostConversationTurn | undefined;
    const resolveModelApiKey = vi.fn(async () => 'model-api-key');
    const service = new HostedConversationTurnService({
      authority: authority((input) => {
        issuedInput = input;
        return issued('execution-assertion', 'mcp-capability');
      }),
      executionHost: {
        streamConversationTurn: async function* (input) {
          hostInput = input;
          yield accepted();
          yield result();
        },
      },
      modelCredentials: { resolveModelApiKey },
      mcp: { allowedTools: ['read_snapshot'] },
    });

    const events = await collect(service.streamTurn(turnInput()));

    expect(issuedInput).toEqual({
      scope: {
        tenantId: 'company-a',
        subjectId: 'user-a',
        productSessionId: 'conversation-a',
      },
      runtimeSessionId: runtimeSessionId(),
      invocationId: 'invocation-001',
      workflow: 'conversation-turn',
      mcp: { allowedTools: ['read_snapshot'] },
    });
    expect(resolveModelApiKey).toHaveBeenCalledWith({
      scope: turnInput().scope,
      invocationId: 'invocation-001',
      signal: undefined,
    });
    expect(hostInput).toEqual({
      invocationId: 'invocation-001',
      runtimeSessionId: runtimeSessionId(),
      prompt: 'Summarize the product state.',
      executionAssertion: 'execution-assertion',
      mcpCapability: 'mcp-capability',
      modelApiKey: 'model-api-key',
    });
    expect(events.map((event) => event.kind)).toEqual(['accepted', 'result']);
    expect(JSON.stringify(service)).toBe('{}');
  });

  it('supports an execution-only workflow without MCP policy', async () => {
    let issuedInput: ExecutionAuthorityIssueInput | undefined;
    let hostInput: ExecutionHostConversationTurn | undefined;
    const service = new HostedConversationTurnService({
      authority: authority((input) => {
        issuedInput = input;
        return issued('execution-assertion');
      }),
      executionHost: {
        streamConversationTurn: async function* (input) {
          hostInput = input;
          yield accepted();
          yield result();
        },
      },
      modelCredentials: {
        resolveModelApiKey: async () => 'model-api-key',
      },
    });

    await collect(service.streamTurn(turnInput()));

    expect(issuedInput).not.toHaveProperty('mcp');
    expect(hostInput).not.toHaveProperty('mcpCapability');
  });

  it('copies tool policy and rejects missing configured capability', async () => {
    const allowedTools = ['read_snapshot'];
    const service = new HostedConversationTurnService({
      authority: authority(() => issued('execution-assertion')),
      executionHost: {
        streamConversationTurn: async function* () {
          yield accepted();
        },
      },
      modelCredentials: {
        resolveModelApiKey: async () => 'model-api-key',
      },
      mcp: { allowedTools },
    });
    allowedTools[0] = 'write_everything';

    await expect(collect(service.streamTurn(turnInput())))
      .rejects.toBeInstanceOf(HostedConversationConfigurationError);
  });

  it('honors cancellation before minting authority', async () => {
    const issue = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const service = new HostedConversationTurnService({
      authority: { issue, publicJwks: () => ({ keys: [] }) },
      executionHost: {
        streamConversationTurn: async function* () {
          yield accepted();
        },
      },
      modelCredentials: {
        resolveModelApiKey: async () => 'model-api-key',
      },
    });

    await expect(collect(service.streamTurn({
      ...turnInput(),
      signal: controller.signal,
    }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(issue).not.toHaveBeenCalled();
  });
});

function authority(
  issue: (
    input: ExecutionAuthorityIssueInput,
  ) => IssuedExecutionAuthority,
): ExecutionAuthority {
  return {
    issue: async (input) => issue(input),
    publicJwks: () => ({ keys: [] }),
  };
}

function issued(
  executionAssertion: string,
  mcpCapability?: string,
): IssuedExecutionAuthority {
  const metadata = {
    scope: {
      adopterId: 'example-adopter',
      tenantId: 'company-a',
      subjectId: 'user-a',
      productSessionId: 'conversation-a',
    },
    runtimeSessionId: runtimeSessionId(),
    invocationId: 'invocation-001',
    workflow: 'conversation-turn' as const,
    issuedAt: '2026-08-10T12:00:00.000Z',
    executionExpiresAt: '2026-08-10T12:05:00.000Z',
  };
  return {
    metadata,
    executionAssertion: () => executionAssertion,
    mcpCapability: () => mcpCapability,
    toJSON: () => metadata,
  };
}

function turnInput() {
  return {
    scope: {
      tenantId: 'company-a',
      subjectId: 'user-a',
      productSessionId: 'conversation-a',
    },
    runtimeSessionId: runtimeSessionId(),
    invocationId: 'invocation-001',
    prompt: 'Summarize the product state.',
  };
}

function accepted(): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-001',
    runId: 'run-001',
    sequence: 0,
    timestamp: '2026-08-10T12:00:00.000Z',
    kind: 'accepted',
  };
}

function result(): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-001',
    runId: 'run-001',
    sequence: 1,
    timestamp: '2026-08-10T12:00:01.000Z',
    kind: 'result',
    result: { outcome: 'done' },
  };
}

async function collect(
  stream: AsyncIterable<ExecutionHostStreamEvent>,
): Promise<ExecutionHostStreamEvent[]> {
  const events: ExecutionHostStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function runtimeSessionId(): string {
  return 'runtime-session-001-abcdefghijklmnop';
}
