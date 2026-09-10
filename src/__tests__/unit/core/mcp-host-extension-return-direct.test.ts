import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunService } from '@/core/agent/index.js';
import { prepareMcpHostExtension } from '@/core/chat/engine/index.js';
import type { LlmAdapter, LlmResponse } from '@/core/llm/types.js';
import { McpClientService } from '@/core/mcp/index.js';
import type { McpCallToolResult } from '@/core/mcp/index.js';
import type { ToolDefinition } from '@/core/types.js';
import type { ToolToolkitContext } from '@/core/tools/index.js';
import { createLogger } from '@/core/utils/logger.js';

const silentLogger = createLogger({ level: 'silent', console: false });

type PreparedMcpTool = {
  tool: ToolDefinition;
  callTool: ReturnType<typeof vi.spyOn>;
};

async function prepareMcpTool(options: {
  result: McpCallToolResult;
  returnDirect?: boolean;
}): Promise<PreparedMcpTool> {
  vi.spyOn(McpClientService.prototype, 'listTools').mockResolvedValue({
    tools: [{
      name: 'commit_workflow_result',
      description: 'Commit the canonical workflow result.',
      inputSchema: { type: 'object', properties: {} },
    }],
  });
  const callTool = vi.spyOn(McpClientService.prototype, 'callTool')
    .mockResolvedValue(options.result);
  const prepared = await prepareMcpHostExtension({
    mode: 'request-scoped',
    id: 'workflow-capabilities',
    serverId: 'workflow_backend',
    server: {
      transport: 'http',
      url: 'https://workflow.example/mcp',
      tools: { allow: ['commit_workflow_result'], approval: 'never' },
    },
    includeTools: ['commit_workflow_result'],
    resolveRequestHeaders: async () => ({ Authorization: 'Bearer test-capability' }),
    ...(options.returnDirect === undefined
      ? {}
      : {
          toolOverrides: {
            commit_workflow_result: { returnDirect: options.returnDirect },
          },
        }),
  });

  if (!prepared.ok) {
    throw new Error(prepared.error);
  }

  const context: ToolToolkitContext = {
    workspaceRoot: '/workspace',
    stateRoot: '/state',
    artifactRoot: '/state/artifacts',
    sessionId: 'session-return-direct',
    model: 'gpt-5.5',
    memoryDir: '/state/memory',
    memoryMode: 'none',
  };
  const [tool] = prepared.extension.toolkits
    ?.flatMap((toolkit) => toolkit.createTools(context)) ?? [];
  if (!tool) {
    throw new Error('Expected the prepared MCP extension to expose its selected tool.');
  }

  return { tool, callTool };
}

async function runPreparedTool(tool: ToolDefinition): Promise<{
  modelCalls: number;
  result: Awaited<ReturnType<typeof AgentRunService.run>>;
}> {
  let modelCalls = 0;
  const llm: LlmAdapter = {
    async chat(): Promise<LlmResponse> {
      modelCalls += 1;
      return modelCalls === 1
        ? {
            toolCalls: [{
              id: 'call-terminal',
              tool: 'commit_workflow_result',
              input: {},
            }],
          }
        : { content: 'The workflow continued after the tool result.' };
    },
  };
  const result = await AgentRunService.run({
    goal: 'Complete the workflow.',
    llm,
    tools: [tool],
    maxSteps: 3,
    logger: silentLogger,
  });

  return { modelCalls, result };
}

describe('request-scoped MCP return-direct tools', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finishes from a successful overridden MCP tool without another model turn', async () => {
    const { tool, callTool } = await prepareMcpTool({
      returnDirect: true,
      result: { ok: true, output: 'Workflow result committed.' },
    });

    expect(tool.returnDirect).toBe(true);
    const { modelCalls, result } = await runPreparedTool(tool);

    expect(result).toMatchObject({ outcome: 'done', summary: 'Workflow result committed.' });
    expect(modelCalls).toBe(1);
    expect(callTool).toHaveBeenCalledOnce();
  });

  it('keeps successful non-overridden MCP tools in the ordinary model loop', async () => {
    const { tool, callTool } = await prepareMcpTool({
      result: { ok: true, output: 'Intermediate workflow result.' },
    });

    expect(tool.returnDirect).toBeUndefined();
    const { modelCalls, result } = await runPreparedTool(tool);

    expect(result).toMatchObject({
      outcome: 'done',
      summary: 'The workflow continued after the tool result.',
    });
    expect(modelCalls).toBe(2);
    expect(callTool).toHaveBeenCalledOnce();
  });

  it('keeps failed overridden MCP tools recoverable in the ordinary model loop', async () => {
    const { tool, callTool } = await prepareMcpTool({
      returnDirect: true,
      result: { ok: false, error: 'Workflow result was not committed.' },
    });

    expect(tool.returnDirect).toBe(true);
    const { modelCalls, result } = await runPreparedTool(tool);

    expect(result).toMatchObject({
      outcome: 'done',
      summary: 'The workflow continued after the tool result.',
    });
    expect(result.transcript).toContainEqual({
      role: 'tool',
      content: JSON.stringify({ ok: false, error: 'Workflow result was not committed.' }),
      toolCallId: 'call-terminal',
    });
    expect(modelCalls).toBe(2);
    expect(callTool).toHaveBeenCalledOnce();
  });
});
