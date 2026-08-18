import { z } from 'zod';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  CONVERSATION_TURN_WORKFLOW,
  EXECUTION_ASSERTION_HEADER,
  EXECUTION_ASSERTION_TYPE,
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
  ExecutionAssertionClaimsSchema,
  ExecutionHostConversationTurnRequestSchema,
  ExecutionHostHeartbeatStreamEventSchema,
  ExecutionHostHeartbeatTaskRequestSchema,
  ExecutionHostStreamEventSchema,
  ExecutionScopeSchema,
  HEARTBEAT_TASK_WORKFLOW,
  MCP_CAPABILITY_HEADER,
  MCP_CAPABILITY_TYPE,
  MODEL_API_KEY_HEADER,
  McpCapabilityClaimsSchema,
  RuntimePublicResultSchema,
} from '../src/contracts/index.js';
import {
  HOSTED_CONVERSATION_FAILURE_CODES,
  HOSTED_CONVERSATION_TURN_STATUSES,
  HostedConversationAcceptedTurnSchema,
  HostedConversationExpiredTurnReconciliationSchema,
  HostedConversationPersistenceScopeSchema,
  HostedConversationRequestedTurnSchema,
  HostedConversationTurnIdentitySchema,
  HostedConversationTurnSettlementSchema,
} from '../src/conversation/lifecycle-types.js';

type JsonObject = Record<string, unknown>;

const CONTRACT_BASE_URL =
  'https://heddleagent.com/spec/execution-host/v1' as const;
const FIXTURE_TIMESTAMP = '2026-08-10T04:00:00.000Z';
const FIXTURE_EPOCH_SECONDS = Date.parse(FIXTURE_TIMESTAMP) / 1_000;
const FIXTURE_RUNTIME_SESSION_ID =
  `runtime-session:${'a'.repeat(40)}`;

export function createContractArtifacts(): ReadonlyMap<string, string> {
  const fixtures = createFixtures();
  return new Map([
    ['schema-bundle.json', serialize(createSchemaBundle())],
    ['openapi.json', serialize(createOpenApi(fixtures.validStream))],
    ['fixtures/manifest.json', serialize(fixtures.manifest)],
    ['fixtures/authority.json', serialize(fixtures.authority)],
    ['fixtures/durable-conversation-lifecycle.json', serialize(
      fixtures.durableConversationLifecycle,
    )],
    ['fixtures/valid-request.json', serialize(fixtures.validRequest)],
    ['fixtures/valid-heartbeat-request.json', serialize(
      fixtures.validHeartbeatRequest,
    )],
    ['fixtures/invalid-request-extra-field.json', serialize(
      fixtures.invalidRequestExtraField,
    )],
    ['fixtures/valid-result.sse', fixtures.validStream],
    ['fixtures/valid-heartbeat-result.sse', fixtures.validHeartbeatStream],
    ['fixtures/cancelled.sse', fixtures.cancelledStream],
    ['fixtures/ambiguous-eof.sse', fixtures.ambiguousEofStream],
    ['fixtures/invalid-sequence-gap.sse', fixtures.invalidSequenceGapStream],
  ]);
}

export function createSchemaBundle(): JsonObject {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${CONTRACT_BASE_URL}/schema-bundle.json`,
    title: 'Heddle Execution Host adopter contract v1',
    description: [
      'Language-neutral schemas for invoking an Execution Host, consuming its',
      'ordered event stream, and carrying adopter-issued execution authority.',
    ].join(' '),
    $comment: [
      'JSON Schema validates individual values. Stream ordering, duplicated JWT',
      'claim binding, bounded token age, and total tool-name characters are',
      'semantic invariants described by README.md and executable fixtures.',
    ].join(' '),
    $defs: createSchemaDefinitions(),
  };
}

export function createOpenApi(validStream: string): JsonObject {
  const schemas = createExecutionSchemaDefinitions('#/components/schemas');
  annotateSemantics(schemas);
  return {
    openapi: '3.1.1',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Heddle Execution Host invocation contract',
      version: '1.0.0',
      description: [
        'The language-neutral HTTP/SSE binding between an adopter backend and',
        'a Heddle-compatible Execution Host. Deployment authentication and',
        'runtime routing are binding concerns; credentials stay in headers and',
        'never enter the JSON request body.',
      ].join(' '),
    },
    servers: [],
    paths: {
      '/invocations': {
        post: {
          operationId: 'streamExecutionHostInvocation',
          summary: 'Run one supported Execution Host workflow',
          description: [
            'Starts one conversation turn or heartbeat task and holds one SSE',
            'response open until',
            'a terminal event or an ambiguous interruption. A clean HTTP EOF is',
            'required before a terminal frame may be committed as final.',
          ].join(' '),
          parameters: createInvocationHeaderParameters(),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/ConversationTurnRequest' },
                    { $ref: '#/components/schemas/HeartbeatTaskRequest' },
                  ],
                  discriminator: { propertyName: 'kind' },
                },
              },
            },
          },
          responses: {
            200: {
              description: [
                'Ordered SSE stream. Each frame uses id=<sequence>,',
                'event=<kind>, and one JSON event in data. accepted is sequence',
                'zero; exactly one result, cancelled, or error terminal is last.',
              ].join(' '),
              headers: {
                'Cache-Control': {
                  schema: { type: 'string', const: 'no-store' },
                },
                'X-Content-Type-Options': {
                  schema: { type: 'string', const: 'nosniff' },
                },
              },
              content: {
                'text/event-stream': {
                  schema: { type: 'string' },
                  example: validStream,
                },
              },
            },
            400: errorResponse('Invalid request or duplicated sensitive header.'),
            401: errorResponse('Invalid execution authority or credential.'),
            413: errorResponse('Request body exceeded the deployment limit.'),
            415: errorResponse('Request body was not application/json.'),
            429: errorResponse('The bound runtime session is busy.'),
            500: errorResponse('Execution Host failed safely.'),
            502: errorResponse('An execution dependency could not be prepared.'),
            503: errorResponse('Execution Host or verifier dependency unavailable.'),
          },
        },
      },
    },
    components: { schemas },
  };
}

function createSchemaDefinitions(): JsonObject {
  const definitions: JsonObject = {
    ...createExecutionSchemaDefinitions('#/$defs'),
    HostedConversationPersistenceScope: jsonSchema(
      HostedConversationPersistenceScopeSchema,
    ),
    HostedConversationTurnIdentity: jsonSchema(
      HostedConversationTurnIdentitySchema,
    ),
    HostedConversationRequestedTurn: jsonSchema(
      HostedConversationRequestedTurnSchema,
    ),
    HostedConversationAcceptedTurn: jsonSchema(
      HostedConversationAcceptedTurnSchema,
    ),
    HostedConversationTurnSettlement: jsonSchema(
      HostedConversationTurnSettlementSchema,
    ),
    HostedConversationExpiredTurnReconciliation: jsonSchema(
      HostedConversationExpiredTurnReconciliationSchema,
    ),
  };
  annotateSemantics(definitions);
  return definitions;
}

function createExecutionSchemaDefinitions(referenceRoot: string): JsonObject {
  return {
    ExecutionScope: componentSchema(
      'ExecutionScope',
      ExecutionScopeSchema,
      referenceRoot,
    ),
    ConversationTurnRequest: componentSchema(
      'ConversationTurnRequest',
      ExecutionHostConversationTurnRequestSchema,
      referenceRoot,
    ),
    HeartbeatTaskRequest: componentSchema(
      'HeartbeatTaskRequest',
      ExecutionHostHeartbeatTaskRequestSchema,
      referenceRoot,
    ),
    RuntimePublicResult: componentSchema(
      'RuntimePublicResult',
      RuntimePublicResultSchema,
      referenceRoot,
    ),
    StreamEvent: componentSchema(
      'StreamEvent',
      ExecutionHostStreamEventSchema,
      referenceRoot,
    ),
    HeartbeatStreamEvent: componentSchema(
      'HeartbeatStreamEvent',
      ExecutionHostHeartbeatStreamEventSchema,
      referenceRoot,
    ),
    ExecutionAssertionClaims: componentSchema(
      'ExecutionAssertionClaims',
      ExecutionAssertionClaimsSchema,
      referenceRoot,
    ),
    McpCapabilityClaims: componentSchema(
      'McpCapabilityClaims',
      McpCapabilityClaimsSchema,
      referenceRoot,
    ),
    ExecutionAssertionProtectedHeader: protectedHeaderSchema(
      EXECUTION_ASSERTION_TYPE,
    ),
    McpCapabilityProtectedHeader: protectedHeaderSchema(MCP_CAPABILITY_TYPE),
    ApiError: apiErrorSchema(),
  };
}

function createInvocationHeaderParameters(): JsonObject[] {
  return [
    headerParameter(
      AGENTCORE_RUNTIME_SESSION_HEADER,
      'Logical runtimeSessionId. AgentCore supplies this exact header; another deployment adapter must preserve the same value.',
      { type: 'string', minLength: 33, maxLength: 256 },
      true,
      'agentcore-runtime',
    ),
    headerParameter(
      EXECUTION_ASSERTION_HEADER,
      'Short-lived ES256 admission assertion issued by the adopter backend.',
      { type: 'string', minLength: 32, maxLength: 4096 },
      true,
    ),
    headerParameter(
      MCP_CAPABILITY_HEADER,
      'Optional invocation-bound capability forwarded only to the configured adopter MCP server.',
      { type: 'string', minLength: 32, maxLength: 4096 },
      false,
    ),
    headerParameter(
      MODEL_API_KEY_HEADER,
      'Invocation-scoped model credential. It must be scrubbed before parsing or logging.',
      { type: 'string', minLength: 8, maxLength: 4096 },
      true,
    ),
    headerParameter(
      EXECUTION_HOST_LOCAL_TOKEN_HEADER,
      'Loopback-only direct-development ingress token; managed deployments use their provider ingress instead.',
      { type: 'string', minLength: 8, maxLength: 4096 },
      false,
      'direct-development',
    ),
  ];
}

function headerParameter(
  name: string,
  description: string,
  schema: JsonObject,
  required: boolean,
  binding?: string,
): JsonObject {
  return {
    name,
    in: 'header',
    required,
    description,
    schema,
    ...(binding ? { 'x-heddle-binding': binding } : {}),
  };
}

function errorResponse(description: string): JsonObject {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
      },
    },
  };
}

function protectedHeaderSchema(type: string): JsonObject {
  return {
    type: 'object',
    properties: {
      alg: { type: 'string', const: 'ES256' },
      kid: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._:@-]*$',
      },
      typ: { type: 'string', const: type },
    },
    required: ['alg', 'kid', 'typ'],
    additionalProperties: false,
  };
}

function apiErrorSchema(): JsonObject {
  return {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            pattern: '^[a-z0-9_]+$',
          },
          message: { type: 'string', minLength: 1, maxLength: 1600 },
        },
        required: ['code', 'message'],
        additionalProperties: false,
      },
    },
    required: ['error'],
    additionalProperties: false,
  };
}

function jsonSchema(schema: z.ZodType): JsonObject {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as JsonObject;
  const { $schema: _schema, ...component } = generated;
  return component;
}

function componentSchema(
  name: string,
  schema: z.ZodType,
  referenceRoot: string,
): JsonObject {
  return rewriteNestedSchemaReferences(
    jsonSchema(schema),
    `${referenceRoot}/${name}/$defs`,
  ) as JsonObject;
}

function rewriteNestedSchemaReferences(
  value: unknown,
  nestedDefinitionsPath: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      rewriteNestedSchemaReferences(item, nestedDefinitionsPath),
    );
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === '$ref' &&
      typeof item === 'string' &&
      item.startsWith('#/$defs/')
        ? `${nestedDefinitionsPath}/${item.slice('#/$defs/'.length)}`
        : rewriteNestedSchemaReferences(item, nestedDefinitionsPath),
    ]),
  );
}

function annotateSemantics(definitions: JsonObject): void {
  for (const definitionName of [
    'ExecutionAssertionClaims',
    'McpCapabilityClaims',
  ]) {
    property(definitions[definitionName], 'runtimeSessionId')[
      'x-heddle-trimmed'
    ] = true;
  }
  property(definitions.ConversationTurnRequest, 'prompt')[
    'x-heddle-trimmed'
  ] = true;
  property(definitions.HeartbeatTaskRequest, 'task')[
    'x-heddle-trimmed'
  ] = true;
  const allowedTools = property(
    definitions.McpCapabilityClaims,
    'allowedTools',
  );
  allowedTools.uniqueItems = true;
  allowedTools['x-heddle-max-total-item-characters'] = 512;
}

function property(schema: unknown, name: string): JsonObject {
  const object = schema as { properties?: JsonObject };
  return object.properties?.[name] as JsonObject;
}

function createFixtures() {
  const validRequest = {
    schemaVersion: EXECUTION_CONTRACT_VERSION,
    kind: CONVERSATION_TURN_WORKFLOW,
    invocationId: 'invocation-001',
    prompt: 'Summarize the current product state.',
    deadlineAt: '2026-08-10T04:10:00.000Z',
  };
  const invalidRequestExtraField = {
    ...validRequest,
    tenantId: 'caller-must-not-select-authority-in-body',
  };
  const validHeartbeatRequest = {
    schemaVersion: EXECUTION_CONTRACT_VERSION,
    kind: HEARTBEAT_TASK_WORKFLOW,
    invocationId: 'heartbeat-execution-001',
    taskId: 'heartbeat-task-001',
    task: 'Review the workspace for actionable changes.',
    checkpoint: {
      version: 1,
      createdAt: FIXTURE_TIMESTAMP,
      state: { runId: 'prior-run-001' },
    },
    runContext: {
      currentDateTime: FIXTURE_TIMESTAMP,
      intervalMs: 60_000,
      continuationMode: 'operator',
      previousRunId: 'prior-run-001',
    },
    model: 'openai:gpt-5.6',
    maxSteps: 24,
    deadlineAt: '2026-08-10T04:10:00.000Z',
  };
  const accepted = streamEvent(0, { kind: 'accepted' });
  const activity = streamEvent(1, {
    kind: 'activity',
    activity: { type: 'assistant_text_delta', text: 'Working.' },
  });
  const validStream = toSse([
    accepted,
    activity,
    streamEvent(2, {
      kind: 'result',
      result: { outcome: 'done', summary: 'Complete.' },
    }),
  ]);
  const heartbeatAccepted = streamEvent(0, {
    kind: 'accepted',
  }, 'heartbeat-execution-001', 'heartbeat-run-001');
  const validHeartbeatStream = toSse([
    heartbeatAccepted,
    streamEvent(1, {
      kind: 'activity',
      activity: { type: 'heartbeat.decision', decision: 'continue' },
    }, 'heartbeat-execution-001', 'heartbeat-run-001'),
    streamEvent(2, {
      kind: 'result',
      result: {
        decision: 'continue',
        summary: 'No operator action required.',
        checkpoint: {
          version: 1,
          createdAt: FIXTURE_TIMESTAMP,
          state: { runId: 'heartbeat-run-001' },
        },
        state: {
          runId: 'heartbeat-run-001',
          outcome: 'done',
          summary: 'No operator action required.',
        },
      },
    }, 'heartbeat-execution-001', 'heartbeat-run-001'),
  ]);
  const cancelledStream = toSse([
    accepted,
    streamEvent(1, { kind: 'cancelled', reason: 'product_cancelled' }),
  ]);
  const ambiguousEofStream = toSse([accepted, activity]);
  const invalidSequenceGapStream = toSse([
    accepted,
    streamEvent(2, { kind: 'activity', activity: { type: 'checkpointed' } }),
  ]);
  const authority = createAuthorityFixture();
  const durableConversationLifecycle = createDurableLifecycleFixture();
  const manifest = {
    contractVersion: EXECUTION_CONTRACT_VERSION,
    cases: [
      fixtureCase('valid-request', 'valid-request.json', 'json-schema', 'valid'),
      fixtureCase(
        'valid-heartbeat-request',
        'valid-heartbeat-request.json',
        'json-schema',
        'valid',
      ),
      fixtureCase(
        'request-authority-in-body',
        'invalid-request-extra-field.json',
        'json-schema',
        'invalid',
      ),
      fixtureCase('valid-result', 'valid-result.sse', 'sse', 'complete'),
      fixtureCase(
        'valid-heartbeat-result',
        'valid-heartbeat-result.sse',
        'sse',
        'complete',
      ),
      fixtureCase('cancelled', 'cancelled.sse', 'sse', 'cancelled'),
      fixtureCase('ambiguous-eof', 'ambiguous-eof.sse', 'sse', 'interrupted'),
      fixtureCase(
        'invalid-sequence-gap',
        'invalid-sequence-gap.sse',
        'sse',
        'protocol_error',
      ),
      fixtureCase('authority', 'authority.json', 'authority', 'valid'),
      fixtureCase(
        'durable-conversation-lifecycle',
        'durable-conversation-lifecycle.json',
        'lifecycle',
        'conformant',
      ),
    ],
  };
  return {
    manifest,
    authority,
    durableConversationLifecycle,
    validRequest,
    validHeartbeatRequest,
    invalidRequestExtraField,
    validStream,
    validHeartbeatStream,
    cancelledStream,
    ambiguousEofStream,
    invalidSequenceGapStream,
  };
}

function createDurableLifecycleFixture(): JsonObject {
  const scope = {
    tenantId: 'tenant-a',
    subjectId: 'subject-a',
    productSessionId: 'product-session-a',
  };
  const otherScope = {
    tenantId: 'tenant-b',
    subjectId: 'subject-b',
    productSessionId: 'product-session-b',
  };
  const requestedAt = '2026-08-14T00:00:00.000Z';
  const acceptedAt = '2026-08-14T00:00:01.000Z';
  const settledAt = '2026-08-14T00:00:02.000Z';
  const deadlineAt = '2026-08-14T00:05:00.000Z';
  const requested = lifecycleRequested(
    'lifecycle-invocation-001',
    scope,
    requestedAt,
    deadlineAt,
  );
  const accepted = {
    invocationId: requested.invocationId,
    scope,
    runId: 'lifecycle-run-001',
    acceptedAt,
  };
  const completed = {
    invocationId: requested.invocationId,
    scope,
    status: 'completed',
    summary: 'Done.',
    settledAt,
  };
  const terminalCases = [
    lifecycleTerminalCase(
      'completed',
      { outcome: 'done', summary: 'Done.' },
      { status: 'completed', summary: 'Done.' },
    ),
    lifecycleTerminalCase(
      'max-steps',
      { outcome: 'max_steps', summary: 'Part.' },
      { status: 'max_steps', summary: 'Part.' },
    ),
    lifecycleTerminalCase(
      'result-error',
      { outcome: 'error' },
      { status: 'failed', failureCode: 'execution_result_error' },
    ),
    lifecycleTerminalCase(
      'result-interrupted',
      { outcome: 'interrupted', summary: 'Part.' },
      {
        status: 'interrupted',
        summary: 'Part.',
        failureCode: 'execution_interrupted',
      },
    ),
    ...Object.entries({
      authentication: 'model_authentication',
      permission: 'model_permission',
      quota: 'model_quota',
      rate_limit: 'model_rate_limit',
      context_window: 'model_context_window',
      request: 'model_request',
      transport: 'model_transport',
      empty_response: 'model_empty_response',
      unknown: 'model_unknown',
    }).map(([modelCode, failureCode]) => lifecycleTerminalCase(
      `model-${modelCode}`,
      {
        outcome: 'error',
        failure: { source: 'model', code: modelCode },
      },
      { status: 'failed', failureCode },
    )),
    {
      id: 'explicit-cancellation',
      maxSummaryCharacters: 100,
      event: lifecycleEvent({
        sequence: 1,
        kind: 'cancelled',
        reason: 'private cancellation detail',
      }),
      expectedEvent: lifecycleEvent({
        sequence: 1,
        kind: 'cancelled',
        reason: 'private cancellation detail',
      }),
      expectedSettlement: {
        status: 'cancelled',
        failureCode: 'invocation_cancelled',
      },
    },
    {
      id: 'public-host-error',
      maxSummaryCharacters: 100,
      event: lifecycleEvent({
        sequence: 1,
        kind: 'error',
        error: {
          code: 'provider_token_ghp_secret',
          message: 'private host detail',
        },
      }),
      expectedEvent: lifecycleEvent({
        sequence: 1,
        kind: 'error',
        error: {
          code: 'provider_token_ghp_secret',
          message: 'private host detail',
        },
      }),
      expectedSettlement: {
        status: 'failed',
        failureCode: 'execution_error',
      },
    },
    {
      id: 'unicode-summary-bound',
      maxSummaryCharacters: 5,
      event: lifecycleEvent({
        sequence: 1,
        kind: 'result',
        result: { outcome: 'done', summary: 'A😀BCDE' },
      }),
      expectedEvent: lifecycleEvent({
        sequence: 1,
        kind: 'result',
        result: { outcome: 'done', summary: 'A😀BCD' },
      }),
      expectedSettlement: {
        status: 'completed',
        summary: 'A😀BCD',
      },
    },
  ];
  return {
    profile: 'durable-hosted-conversation-lifecycle',
    contractVersion: EXECUTION_CONTRACT_VERSION,
    summaryCharacterUnit: 'unicode-code-point',
    statuses: HOSTED_CONVERSATION_TURN_STATUSES,
    failureCodes: HOSTED_CONVERSATION_FAILURE_CODES,
    scope,
    otherScope,
    timestamps: { requestedAt, acceptedAt, settledAt, deadlineAt },
    terminalProjectionCases: terminalCases,
    thrownFailureCases: [
      thrownFailureCase('stream-interrupted', 'stream_interrupted'),
      thrownFailureCase('invocation-aborted', 'invocation_aborted'),
      thrownFailureCase('protocol-error', 'host_protocol_error', 'failed'),
      thrownFailureCase('host-rejected', 'host_rejected', 'failed'),
      thrownFailureCase('unexpected-error', 'execution_failed', 'failed'),
    ],
    storeCases: {
      lifecycleAndFencing: {
        requested,
        wrongScopeAccepted: { ...accepted, scope: otherScope },
        accepted,
        conflictingAccepted: {
          ...accepted,
          runId: 'lifecycle-run-conflict',
        },
        conflictingAcceptedAt: {
          ...accepted,
          acceptedAt: '2026-08-14T00:00:01.500Z',
        },
        completed,
        wrongScopeCompleted: { ...completed, scope: otherScope },
        conflictingCompleted: {
          ...completed,
          status: 'failed',
          summary: undefined,
          failureCode: 'execution_failed',
        },
        conflictingSettledAt: {
          ...completed,
          settledAt: '2026-08-14T00:00:02.500Z',
        },
        expectedRunning: {
          ...requested,
          status: 'running',
          runId: accepted.runId,
          acceptedAt,
        },
        expectedCompleted: {
          ...requested,
          status: 'completed',
          runId: accepted.runId,
          acceptedAt,
          summary: completed.summary,
          settledAt,
        },
      },
      preAcceptanceFailure: {
        requested: lifecycleRequested(
          'lifecycle-pre-accept-failure',
          scope,
          requestedAt,
          deadlineAt,
        ),
        settlement: {
          invocationId: 'lifecycle-pre-accept-failure',
          scope,
          status: 'failed',
          failureCode: 'execution_failed',
          settledAt,
        },
      },
      expiry: {
        expiredRequested: lifecycleRequested(
          'lifecycle-expired-requested',
          scope,
          '2026-08-13T23:55:00.000Z',
          '2026-08-13T23:58:00.000Z',
        ),
        expiredRunning: lifecycleRequested(
          'lifecycle-expired-running',
          scope,
          '2026-08-13T23:55:00.000Z',
          '2026-08-13T23:58:00.000Z',
        ),
        expiredRunningAcceptance: {
          invocationId: 'lifecycle-expired-running',
          scope,
          runId: 'lifecycle-expired-run',
          acceptedAt: '2026-08-13T23:56:00.000Z',
        },
        futureRequested: lifecycleRequested(
          'lifecycle-future-requested',
          scope,
          requestedAt,
          '2026-08-14T00:10:00.000Z',
        ),
        terminalRequested: lifecycleRequested(
          'lifecycle-terminal-before-expiry',
          scope,
          '2026-08-13T23:55:00.000Z',
          '2026-08-13T23:58:00.000Z',
        ),
        terminalSettlement: {
          invocationId: 'lifecycle-terminal-before-expiry',
          scope,
          status: 'failed',
          failureCode: 'execution_failed',
          settledAt: '2026-08-13T23:57:00.000Z',
        },
        otherScopeExpired: lifecycleRequested(
          'lifecycle-other-scope-expired',
          otherScope,
          '2026-08-13T23:55:00.000Z',
          '2026-08-13T23:58:00.000Z',
        ),
        reconciliation: {
          scope,
          expiredBefore: '2026-08-13T23:59:00.000Z',
          settledAt,
        },
      },
    },
  };
}

function lifecycleRequested(
  invocationId: string,
  scope: JsonObject,
  requestedAt: string,
  deadlineAt: string,
): JsonObject {
  return {
    invocationId,
    scope,
    prompt: 'Run the durable lifecycle conformance case.',
    deadlineAt,
    requestedAt,
  };
}

function lifecycleTerminalCase(
  id: string,
  result: JsonObject,
  expectedSettlement: JsonObject,
): JsonObject {
  const event = lifecycleEvent({ sequence: 1, kind: 'result', result });
  return {
    id,
    maxSummaryCharacters: 100,
    event,
    expectedEvent: event,
    expectedSettlement,
  };
}

function lifecycleEvent(body: JsonObject): JsonObject {
  return {
    schemaVersion: EXECUTION_CONTRACT_VERSION,
    invocationId: 'lifecycle-invocation-001',
    runId: 'lifecycle-run-001',
    timestamp: '2026-08-14T00:00:02.000Z',
    ...body,
  };
}

function thrownFailureCase(
  id: string,
  failureCode: string,
  status = 'interrupted',
): JsonObject {
  return { id, expectedSettlement: { status, failureCode } };
}

function createAuthorityFixture(): JsonObject {
  const executionClaims = {
    iss: 'https://api.example.test',
    aud: 'urn:heddle-execution-host:example',
    contractVersion: EXECUTION_CONTRACT_VERSION,
    adopterId: 'example-adopter',
    tenantId: 'tenant-a',
    productSessionId: 'product-session-a',
    runtimeSessionId: FIXTURE_RUNTIME_SESSION_ID,
    workflow: CONVERSATION_TURN_WORKFLOW,
    sub: 'subject-a',
    jti: 'invocation-001',
    iat: FIXTURE_EPOCH_SECONDS,
    exp: FIXTURE_EPOCH_SECONDS + 300,
  };
  const mcpClaims = {
    ...executionClaims,
    aud: 'urn:example:mcp',
    invocationId: executionClaims.jti,
    serverId: 'product_capabilities',
    allowedTools: ['read_snapshot'],
    jti: 'capability-001',
    exp: FIXTURE_EPOCH_SECONDS + 600,
  };
  return {
    referenceTime: FIXTURE_TIMESTAMP,
    issuer: 'https://api.example.test',
    keyId: 'test-key-001',
    executionAudience: 'urn:heddle-execution-host:example',
    mcpAudience: 'urn:example:mcp',
    supportedTools: ['read_snapshot'],
    expected: { executionClaims, mcpClaims },
    invalidMcpCases: [
      {
        id: 'expired',
        overrides: { exp: FIXTURE_EPOCH_SECONDS - 1 },
        expected: 'invalid',
      },
      {
        id: 'unsupported-tool',
        overrides: { allowedTools: ['delete_workspace'] },
        expected: 'invalid',
      },
      {
        id: 'swapped-runtime-session',
        overrides: { runtimeSessionId: `runtime-session:${'b'.repeat(40)}` },
        expected: 'host_binding_invalid',
      },
    ],
  };
}

function streamEvent(
  sequence: number,
  body: JsonObject,
  invocationId = 'invocation-001',
  runId = 'run-001',
): JsonObject {
  return {
    schemaVersion: EXECUTION_CONTRACT_VERSION,
    invocationId,
    runId,
    sequence,
    timestamp: FIXTURE_TIMESTAMP,
    ...body,
  };
}

function toSse(events: readonly JsonObject[]): string {
  const frames = events.map((event) => [
    `id: ${String(event.sequence)}`,
    `event: ${String(event.kind)}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n')).join('');
  // The comment is not an event. It gives checked-in text fixtures a visible
  // clean-EOF boundary after the final frame delimiter.
  return `${frames}: fixture-clean-eof\n`;
}

function fixtureCase(
  id: string,
  file: string,
  kind: string,
  expected: string,
): JsonObject {
  return { id, file, kind, expected };
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
