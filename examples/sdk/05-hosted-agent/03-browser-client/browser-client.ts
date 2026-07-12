/**
 * Stage 05.3 browser client contract for the example REST/SSE API.
 *
 * Heddle owns fetch/SSE correctness. This module supplies the host's public
 * schemas and protocol without wrapping the SDK client in another service.
 */
import type { ConversationRunHttpSseClient } from '../../../../src/core/chat/remote/http-sse/index.js';
import {
  CancelHostedAgentRunResultSchema,
  HostedAgentRunProtocol,
  StartHostedAgentRunResultSchema,
  type CancelHostedAgentRunResult,
  type HostedAgentActivity,
  type HostedAgentResult,
  type StartHostedAgentRunInput,
  type StartHostedAgentRunResult,
} from '../02-http-sse-api/contracts.js';

export const HostedAgentClientContract = {
  protocol: HostedAgentRunProtocol,
  accepted: StartHostedAgentRunResultSchema,
  cancellation: CancelHostedAgentRunResultSchema,
} as const;

export type HostedAgentClient = ConversationRunHttpSseClient<
  StartHostedAgentRunInput,
  StartHostedAgentRunResult,
  HostedAgentActivity,
  HostedAgentResult,
  CancelHostedAgentRunResult
>;
