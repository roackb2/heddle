#!/usr/bin/env node
import {
  createCyberLoopObserver,
  runAgentLoop,
  type CyberLoopCompatibleMiddleware,
  type HeddleRuntimeFrame,
  type LlmAdapter,
  type LlmResponse,
  type ToolDefinition,
} from '../src/index.js';

const createMockLlm = (): LlmAdapter => {
  let turn = 0;
  return {
    info: {
      provider: 'openai',
      model: 'gpt-demo',
      capabilities: {
        toolCalls: true,
        systemMessages: true,
        reasoningSummaries: false,
        parallelToolCalls: true,
      },
    },
    async chat(): Promise<LlmResponse> {
      turn++;
      if (turn === 1) {
        return {
          content: 'I will inspect the project before answering.',
          toolCalls: [{ id: 'call-1', tool: 'inspect', input: { target: 'README.md' } }],
        };
      }
      return { content: 'The project is a terminal coding agent runtime.' };
    },
  };
};

const inspectTool: ToolDefinition = {
  name: 'inspect',
  description: 'Demo inspection tool.',
  parameters: {
    type: 'object',
    properties: { target: { type: 'string' } },
    required: ['target'],
  },
  async execute(input) {
    return { ok: true, output: `inspected ${JSON.stringify(input)}` };
  },
};

/**
 * This is intentionally only CyberLoop-compatible. In a real integration,
 * callers can pass actual middleware from `cyberloop` or `cyberloop/advanced`.
 */
const demoDriftMiddleware: CyberLoopCompatibleMiddleware<HeddleRuntimeFrame> = {
  name: 'demo-drift',
  async beforeStep(ctx) {
    const isToolFailure = ctx.state.kind === 'tool' && ctx.state.ok === false;
    return {
      ...ctx,
      metadata: {
        ...ctx.metadata,
        kinematics: {
          isStable: !isToolFailure,
          correctionMagnitude: isToolFailure ? 1 : 0,
        },
      },
    };
  },
};

async function main() {
  const observer = createCyberLoopObserver({
    middleware: [demoDriftMiddleware],
    onAnnotation(annotation) {
      console.log(`[cyberloop] step=${annotation.step} kind=${annotation.frame.kind} drift=${annotation.driftLevel}`);
    },
  });

  const result = await runAgentLoop({
    goal: 'What does this project do?',
    llm: createMockLlm(),
    tools: [inspectTool],
    includeDefaultTools: false,
    maxSteps: 3,
    onEvent: observer.handleEvent,
  });
  await observer.flush();

  console.log(`\nFinal answer:\n${result.summary}`);
}

await main();
