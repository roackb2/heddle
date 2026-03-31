import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { useMemo, useState } from 'react';
import { Box, Text, render } from 'ink';
import { TextInput } from '@inkjs/ui';
import type { ChatMessage, TraceEvent } from '../src/index.js';
import {
  DEFAULT_OPENAI_MODEL,
  runAgent,
  createOpenAiAdapter,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  reportStateTool,
  createRunShellTool,
  createLogger,
} from '../src/index.js';

type TurnSummary = {
  id: string;
  prompt: string;
  outcome: string;
  steps: number;
  traceFile: string;
  events: string[];
};

type ConversationLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

const model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
const maxSteps = parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40;
const apiKey = process.env.OPENAI_API_KEY ?? process.env.PERSONAL_OPENAI_API_KEY;
const sessionId = `chat-${Date.now()}`;
const logFile = join(process.cwd(), 'local', 'logs', `${sessionId}.log`);
const logger = createLogger({
  pretty: false,
  level: 'debug',
  console: false,
  logFilePath: logFile,
});

function App() {
  const llm = useMemo(() => createOpenAiAdapter({ model, apiKey }), []);
  const tools = useMemo(
    () => [listFilesTool, readFileTool, searchFilesTool, reportStateTool, createRunShellTool()],
    [],
  );

  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [messages, setMessages] = useState<ConversationLine[]>([
    {
      id: 'intro',
      role: 'assistant',
      text:
        'Heddle conversational mode. Ask a question about this workspace. Each turn runs the current agent loop and carries the transcript into the next turn.',
    },
    ...(!apiKey ?
      [{
        id: 'missing-key',
        role: 'assistant' as const,
        text:
          'No OpenAI API key detected. Set OPENAI_API_KEY or PERSONAL_OPENAI_API_KEY, or use yarn chat:dev if your shell exposes PERSONAL_OPENAI_API_KEY.',
      }]
    : []),
  ]);
  const [turns, setTurns] = useState<TurnSummary[]>([]);
  const [status, setStatus] = useState('Idle');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState('');

  const submitPrompt = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || isRunning) {
      return;
    }

    if (!apiKey) {
      setError('Missing OpenAI API key');
      setStatus('Error');
      return;
    }

    setError(undefined);
    setIsRunning(true);
    setStatus('Running');
    setMessages((current: ConversationLine[]) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', text: prompt },
    ]);

    try {
      const result = await runAgent({
        goal: prompt,
        llm,
        tools,
        maxSteps,
        logger,
        history,
      });

      setHistory(result.transcript);
      setMessages(buildConversationMessages(result.transcript));

      const traceFile = saveTrace(result.trace);
      const nextTurn: TurnSummary = {
        id: String(Date.now()),
        prompt,
        outcome: result.outcome,
        steps: countAssistantSteps(result.trace),
        traceFile,
        events: summarizeTrace(result.trace),
      };
      setTurns((current: TurnSummary[]) => [...current, nextTurn].slice(-8));
      if (result.outcome === 'error') {
        setError(result.summary);
      }
      setStatus(result.outcome === 'done' ? 'Idle' : `Stopped: ${result.outcome}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus('Error');
      setMessages((current: ConversationLine[]) => [
        ...current,
        { id: `error-${Date.now()}`, role: 'assistant', text: `Run failed before a final answer: ${message}` },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Heddle Chat</Text>
        <Text color="cyan">
          model={model} maxSteps={maxSteps} cwd={process.cwd()}
        </Text>
        <Text dimColor>logs={logFile}</Text>
        <Text color={error ? 'red' : isRunning ? 'yellow' : 'green'}>
          status={isRunning ? 'running' : status}
        </Text>
        {error ? <Text color="red">{error}</Text> : null}
        <Text dimColor>Ctrl+C to exit</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Conversation</Text>
        {messages.slice(-10).map((message) => (
          <Box key={message.id} borderStyle="round" borderColor={message.role === 'user' ? 'cyan' : 'gray'} paddingX={1} marginBottom={1}>
            <Text color={message.role === 'user' ? 'cyan' : 'white'}>
              {message.role === 'user' ? 'You' : 'Heddle'}: {message.text}
            </Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Recent Turns</Text>
        {turns.length === 0 ?
          <Text dimColor>No completed turns yet.</Text>
        : turns.slice(-3).map((turn) => (
            <Box key={turn.id} flexDirection="column" marginBottom={1}>
              <Text color="magenta">
                {turn.prompt}
              </Text>
              <Text dimColor>
                outcome={turn.outcome} steps={turn.steps} trace={turn.traceFile}
              </Text>
              {turn.events.slice(0, 6).map((event, index) => (
                <Box key={`${turn.id}-${index}`}>
                  <Text dimColor>
                    {event}
                  </Text>
                </Box>
              ))}
            </Box>
          ))
        }
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor={isRunning ? 'yellow' : 'cyan'} paddingX={1} paddingY={0}>
        <Text bold>{isRunning ? 'Working...' : 'Prompt'}</Text>
        <Box>
          <Text color="cyan">{'>'} </Text>
          <Box flexGrow={1}>
            <TextInput
              isDisabled={isRunning}
              placeholder="Ask Heddle about this repo"
              onChange={setDraft}
              onSubmit={(value) => {
                setDraft('');
                void submitPrompt(value);
              }}
            />
          </Box>
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor>{draft ? `${draft.length} chars` : 'Enter to send'}</Text>
          <Text dimColor>Ctrl+C to exit</Text>
        </Box>
      </Box>
    </Box>
  );
}

render(<App />);

function buildConversationMessages(history: ChatMessage[]): ConversationLine[] {
  return history.flatMap((message, index) => {
    if (message.role === 'user' || message.role === 'assistant') {
      if (!message.content.trim()) {
        return [];
      }

      return [{ id: `${message.role}-${index}`, role: message.role, text: message.content }];
    }

    return [];
  });
}

function saveTrace(trace: TraceEvent[]): string {
  const traceDir = join(process.cwd(), 'local', 'traces');
  mkdirSync(traceDir, { recursive: true });
  const traceFile = join(traceDir, `trace-${Date.now()}.json`);
  writeFileSync(traceFile, JSON.stringify(trace, null, 2));
  return traceFile;
}

function summarizeTrace(trace: TraceEvent[]): string[] {
  return trace.flatMap((event) => {
    switch (event.type) {
      case 'assistant.turn':
        return [event.requestedTools ? `assistant requested ${event.toolCalls?.map((call) => call.tool).join(', ')}` : 'assistant answered'];
      case 'tool.call':
        return [`tool call ${event.call.tool}`];
      case 'tool.result':
        return [`tool result ${event.tool}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`];
      case 'run.finished':
        return [`run finished: ${event.outcome}`];
      default:
        return [];
    }
  });
}

function countAssistantSteps(trace: TraceEvent[]): number {
  return trace.filter((event) => event.type === 'assistant.turn').length;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}
