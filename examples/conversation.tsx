import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import type { ChatMessage, ToolCall, ToolDefinition, TraceEvent } from '../src/index.js';
import {
  DEFAULT_OPENAI_MODEL,
  runAgent,
  createOpenAiAdapter,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  reportStateTool,
  createRunShellInspectTool,
  createRunShellMutateTool,
  createLogger,
} from '../src/index.js';

type TurnSummary = {
  id: string;
  prompt: string;
  outcome: string;
  summary: string;
  steps: number;
  traceFile: string;
  events: string[];
};

type ConversationLine = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type LiveEvent = {
  id: string;
  text: string;
};

type PendingApproval = {
  call: ToolCall;
  tool: ToolDefinition;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
};

type ApprovalChoice = 'approve' | 'deny';
type LocalCommandResult =
  | { handled: false }
  | { handled: true; kind: 'message'; message: string }
  | { handled: true; kind: 'continue' };

const model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
const maxSteps = parsePositiveInt(process.env.HEDDLE_MAX_STEPS) ?? 40;
const apiKey = process.env.OPENAI_API_KEY ?? process.env.PERSONAL_OPENAI_API_KEY;
const sessionId = `chat-${Date.now()}`;
const logFile = join(process.cwd(), 'local', 'logs', `${sessionId}.log`);
const knownModels = ['gpt-5.1-codex-mini', 'gpt-5.1-codex'];
const workingFrames = ['.', '..', '...'];
const MAX_VISIBLE_INPUT_CHARS = 96;
const logger = createLogger({
  pretty: false,
  level: 'debug',
  console: false,
  logFilePath: logFile,
});

function App() {
  const nextIdRef = useRef(0);
  const [activeModel, setActiveModel] = useState(model);
  const llm = useMemo(() => createOpenAiAdapter({ model: activeModel, apiKey }), [activeModel]);
  const tools = useMemo(
    () => [
      listFilesTool,
      readFileTool,
      searchFilesTool,
      reportStateTool,
      createRunShellInspectTool(),
      createRunShellMutateTool(),
    ],
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
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [workingFrame, setWorkingFrame] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | undefined>();
  const [approvalChoice, setApprovalChoice] = useState<ApprovalChoice>('approve');
  const [interruptRequested, setInterruptRequested] = useState(false);
  const [lastContinuePrompt, setLastContinuePrompt] = useState<string | undefined>();
  const interruptRequestedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const nextLocalId = () => `ui-${Date.now()}-${nextIdRef.current++}`;

  useInput((input, key) => {
    if (!pendingApproval) {
      if (isRunning && key.escape) {
        interruptRequestedRef.current = true;
        setInterruptRequested(true);
        abortControllerRef.current?.abort();
      }
      return;
    }

    if (key.leftArrow || key.upArrow || key.tab) {
      setApprovalChoice('approve');
      return;
    }

    if (key.rightArrow || key.downArrow) {
      setApprovalChoice('deny');
      return;
    }

    if (key.return) {
      const approved = approvalChoice === 'approve';
      pendingApproval.resolve({
        approved,
        reason: approved ? 'Approved in chat UI' : 'Denied in chat UI',
      });
      setPendingApproval(undefined);
      setApprovalChoice('approve');
      return;
    }

    const normalized = input.toLowerCase();
    if (normalized === 'y') {
      setApprovalChoice('approve');
      return;
    }

    if (normalized === 'n') {
      setApprovalChoice('deny');
      return;
    }

    if (key.escape) {
      pendingApproval.resolve({ approved: false, reason: 'Denied in chat UI' });
      setPendingApproval(undefined);
      setApprovalChoice('approve');
    }
  }, { isActive: Boolean(pendingApproval) || isRunning });

  useEffect(() => {
    if (!isRunning) {
      setWorkingFrame(0);
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      setWorkingFrame((current) => (current + 1) % workingFrames.length);
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 300);

    return () => clearInterval(timer);
  }, [isRunning]);

  const executeTurn = async (prompt: string, displayText?: string) => {
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
    interruptRequestedRef.current = false;
    setInterruptRequested(false);
    abortControllerRef.current = new AbortController();
    setLiveEvents([]);
    setLastContinuePrompt(prompt);

    if (displayText) {
      const nextUserMessage: ConversationLine = { id: nextLocalId(), role: 'user', text: displayText };
      setMessages((current: ConversationLine[]) => [
        ...current,
        nextUserMessage,
      ]);
    }

    try {
      const result = await runAgent({
        goal: prompt,
        llm,
        tools,
        maxSteps,
        logger,
        history,
        onEvent: (event) => {
          const next = toLiveEvent(event);
          if (!next) {
            return;
          }
          setLiveEvents((current) => {
            const previous = current[current.length - 1];
            if (previous?.text === next) {
              return current;
            }

            return [...current, { id: nextLocalId(), text: next }].slice(-8);
          });
        },
        approveToolCall: (call, tool) =>
          new Promise((resolve) => {
            setPendingApproval({ call, tool, resolve });
          }),
        shouldStop: () => interruptRequestedRef.current,
        abortSignal: abortControllerRef.current.signal,
      });

      setHistory(result.transcript);
      setMessages(buildConversationMessages(result.transcript));

      const traceFile = saveTrace(result.trace);
      const nextTurn: TurnSummary = {
        id: nextLocalId(),
        prompt,
        outcome: result.outcome,
        summary: result.summary,
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
        { id: nextLocalId(), role: 'assistant', text: `Run failed before a final answer: ${message}` },
      ]);
    } finally {
      setIsRunning(false);
      interruptRequestedRef.current = false;
      setInterruptRequested(false);
      abortControllerRef.current = undefined;
    }
  };

  const submitPrompt = async (value: string) => {
    const prompt = normalizeInlineText(value);
    if (!prompt || isRunning) {
      return;
    }

    const commandResult = runLocalCommand({
      prompt,
      activeModel,
      setActiveModel,
      clearConversation: () => {
        setHistory([]);
        setTurns([]);
        setLastContinuePrompt(undefined);
        setMessages([
          {
            id: 'intro',
            role: 'assistant',
            text:
              'Heddle conversational mode. Ask a question about this workspace. Each turn runs the current agent loop and carries the transcript into the next turn.',
          },
        ]);
      },
    });

    if (commandResult.handled) {
      if (commandResult.kind === 'message') {
        setMessages((current: ConversationLine[]) => [
          ...current,
          { id: nextLocalId(), role: 'assistant', text: commandResult.message },
        ]);
        setStatus('Idle');
        return;
      }

      if (!history.length || !lastContinuePrompt) {
        setMessages((current: ConversationLine[]) => [
          ...current,
          { id: nextLocalId(), role: 'assistant', text: 'There is no interrupted or prior run to continue yet.' },
        ]);
        setStatus('Idle');
        return;
      }

      setMessages((current: ConversationLine[]) => [
        ...current,
        { id: nextLocalId(), role: 'assistant', text: 'Continuing from the current transcript.' },
      ]);
      await executeTurn('Continue from where you left off.', 'Continue');
      return;
    }

    await executeTurn(prompt, prompt);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Heddle Chat</Text>
        <Text color="cyan">
          model={activeModel} maxSteps={maxSteps} cwd={process.cwd()}
        </Text>
        <Text dimColor>logs={logFile}</Text>
        <Text color={error ? 'red' : isRunning ? 'yellow' : 'green'}>
          status={pendingApproval ? 'awaiting approval' : interruptRequested ? 'interrupt requested' : isRunning ? 'running' : status}
        </Text>
        <Text dimColor>/model &lt;name&gt; • /models • /clear • /help</Text>
        <Text dimColor>
          {pendingApproval ? '←/→ choose • Enter confirms • Esc denies • Ctrl+C exits'
          : isRunning ? 'Esc requests stop after the current step • Ctrl+C exits'
          : 'Cmd+Backspace or Ctrl+U clears to line start • Ctrl+C exits'}
        </Text>
        {error ? <Text color="red">{error}</Text> : null}
      </Box>

      {isRunning ? (
        <>
          <ConversationPanel messages={messages} />
          <RecentTurnsPanel turns={turns} />
          <ActivityPanel
            isRunning={isRunning}
            workingFrame={workingFrame}
            elapsedSeconds={elapsedSeconds}
            liveEvents={liveEvents}
            pendingApproval={pendingApproval}
            interruptRequested={interruptRequested}
          />
        </>
      ) : (
        <>
          <RecentTurnsPanel turns={turns} />
          <ActivityPanel
            isRunning={isRunning}
            workingFrame={workingFrame}
            elapsedSeconds={elapsedSeconds}
            liveEvents={liveEvents}
            pendingApproval={pendingApproval}
            interruptRequested={interruptRequested}
          />
          <ConversationPanel messages={messages} />
        </>
      )}

      <Box flexDirection="column" borderStyle="round" borderColor={pendingApproval ? 'yellow' : isRunning ? 'yellow' : 'cyan'} paddingX={1} paddingY={0}>
        <Text bold color={pendingApproval ? 'yellow' : undefined}>
          {pendingApproval ? 'Approval Required' : isRunning ? `Working${workingFrames[workingFrame]}` : 'Prompt'}
        </Text>
        {pendingApproval ?
          <ApprovalComposer pendingApproval={pendingApproval} approvalChoice={approvalChoice} />
        : (
          <>
            <Box>
              <Text color="cyan">{'>'} </Text>
              <Box flexGrow={1}>
                <PromptInput
                  value={draft}
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
              <Text dimColor>{isRunning ? `${elapsedSeconds}s elapsed` : 'Enter to send'}</Text>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

type ConversationPanelProps = {
  messages: ConversationLine[];
};

function ConversationPanel({ messages }: ConversationPanelProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conversation</Text>
      {messages.slice(-8).map((message) => (
        <Box key={message.id} borderStyle="round" borderColor={message.role === 'user' ? 'cyan' : 'gray'} paddingX={1} marginBottom={1}>
          <Text color={message.role === 'user' ? 'cyan' : 'white'}>
            {message.role === 'user' ? 'You' : 'Heddle'}: {message.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

type RecentTurnsPanelProps = {
  turns: TurnSummary[];
};

function RecentTurnsPanel({ turns }: RecentTurnsPanelProps) {
  const latestTurn = turns[turns.length - 1];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Recent Turns</Text>
      {!latestTurn ?
        <Text dimColor>No completed turns yet.</Text>
      : (
        <Box flexDirection="column">
          <Text color="magenta">{truncate(latestTurn.prompt, 120)}</Text>
          <Text dimColor>
            outcome={latestTurn.outcome} steps={latestTurn.steps} trace={latestTurn.traceFile}
          </Text>
          {latestTurn.outcome !== 'done' ? <Text color="red">{latestTurn.summary}</Text> : null}
          <Text dimColor>
            {latestTurn.events.slice(0, 4).join(' • ')}
          </Text>
        </Box>
      )
      }
    </Box>
  );
}

type ActivityPanelProps = {
  isRunning: boolean;
  workingFrame: number;
  elapsedSeconds: number;
  liveEvents: LiveEvent[];
  pendingApproval?: PendingApproval;
  interruptRequested: boolean;
};

function ActivityPanel({ isRunning, workingFrame, elapsedSeconds, liveEvents, pendingApproval, interruptRequested }: ActivityPanelProps) {
  const visibleEvents = isRunning ? liveEvents.slice(-3) : liveEvents.slice(-1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Current Activity</Text>
      <Text color={pendingApproval ? 'yellow' : interruptRequested ? 'yellow' : isRunning ? 'yellow' : 'gray'}>
        {currentActivityText(liveEvents, isRunning, elapsedSeconds, pendingApproval, interruptRequested)}
      </Text>
      {visibleEvents.map((event) => (
        <Box key={event.id}>
          <Text dimColor>{event.text}</Text>
        </Box>
      ))}
    </Box>
  );
}

type ApprovalComposerProps = {
  pendingApproval: PendingApproval;
  approvalChoice: ApprovalChoice;
};

function ApprovalComposer({ pendingApproval, approvalChoice }: ApprovalComposerProps) {
  return (
    <>
      <Text color="white">{formatApprovalPrompt(pendingApproval)}</Text>
      <Text dimColor>{formatApprovalHint(pendingApproval)}</Text>
      <ApprovalSelector choice={approvalChoice} />
      <Box justifyContent="space-between">
        <Text dimColor>Use ←/→ then Enter</Text>
        <Text dimColor>Input paused during approval</Text>
      </Box>
    </>
  );
}

type ApprovalSelectorProps = {
  choice: ApprovalChoice;
};

function ApprovalSelector({ choice }: ApprovalSelectorProps) {
  return (
    <Box marginBottom={0}>
      <Text color={choice === 'approve' ? 'green' : 'gray'}>
        {choice === 'approve' ? '◉ Approve' : '○ Approve'}
      </Text>
      <Text dimColor>   </Text>
      <Text color={choice === 'deny' ? 'red' : 'gray'}>
        {choice === 'deny' ? '◉ Deny' : '○ Deny'}
      </Text>
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

      return [{ id: `${message.role}-${index}-${message.content}`, role: message.role, text: message.content }];
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
        return [
          ...(event.diagnostics?.rationale ? [`reasoning: ${truncate(event.diagnostics.rationale, 140)}`] : []),
          event.requestedTools ?
            `assistant requested ${event.toolCalls?.map((call) => summarizeToolCall(call.tool, call.input)).join(', ')}`
          : 'assistant answered',
        ];
      case 'tool.approval_requested':
        return [`approval requested for ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.approval_resolved':
        return [
          `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}`,
        ];
      case 'tool.call':
        return [`tool call ${summarizeToolCall(event.call.tool, event.call.input)}`];
      case 'tool.result':
        return [
          `tool result ${summarizeToolResult(event.tool, extractShellCommand(event.result.output))}: ${event.result.ok ? 'ok' : event.result.error ?? 'error'}`,
        ];
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

function toLiveEvent(event: TraceEvent): string | undefined {
  switch (event.type) {
    case 'run.started':
      return `thinking`;
    case 'assistant.turn':
      if (event.diagnostics?.rationale) {
        return `reasoning: ${truncate(event.diagnostics.rationale, 140)}`;
      }
      if (event.requestedTools) {
        return undefined;
      }
      return `answer ready`;
    case 'tool.approval_requested':
      return `approval needed for ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.approval_resolved':
      return `approval ${event.approved ? 'granted' : 'denied'} for ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.call':
      return `running ${summarizeToolCall(event.call.tool, event.call.input)}`;
    case 'tool.result':
      return `${summarizeToolResult(event.tool, extractShellCommand(event.result.output))} ${event.result.ok ? 'completed' : `failed: ${event.result.error ?? 'error'}`}`;
    case 'run.finished':
      return event.outcome === 'done' ? undefined : `stopped: ${event.outcome}`;
    default:
      return undefined;
  }
}

function currentActivityText(
  liveEvents: LiveEvent[],
  isRunning: boolean,
  elapsedSeconds: number,
  pendingApproval?: PendingApproval,
  interruptRequested?: boolean,
): string {
  if (pendingApproval) {
    return formatApprovalPrompt(pendingApproval);
  }

  if (interruptRequested) {
    return 'interrupt requested; waiting for the current step to finish';
  }

  const current = liveEvents[liveEvents.length - 1]?.text;

  if (isRunning) {
    return current ? `${current} · ${elapsedSeconds}s` : 'waiting for first agent event...';
  }

  return current ?? 'idle';
}

function formatApprovalPrompt(pendingApproval: PendingApproval): string {
  const command = extractShellCommand(pendingApproval.call.input);
  if (command) {
    return `Allow mutation command: ${command}`;
  }

  return `Allow ${pendingApproval.call.tool}`;
}

function formatApprovalHint(pendingApproval: PendingApproval): string {
  return `Tool: ${pendingApproval.call.tool}`;
}

function summarizeToolCall(tool: string, input: unknown): string {
  const shellCommand = extractShellCommand(input);
  if (shellCommand) {
    return `${tool} (${shellCommand})`;
  }

  return tool;
}

function summarizeToolResult(tool: string, command: string | undefined): string {
  if (command) {
    return `${tool} (${command})`;
  }

  return tool;
}

function extractShellCommand(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeInlineText(value: string): string {
  return value.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
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

type LocalCommandArgs = {
  prompt: string;
  activeModel: string;
  setActiveModel: (model: string) => void;
  clearConversation: () => void;
};

function runLocalCommand(args: LocalCommandArgs): LocalCommandResult {
  const trimmed = args.prompt.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  if (trimmed === '/help') {
    return {
      handled: true,
      kind: 'message',
      message:
        'Local commands: /model <name> switches the current model, /model shows the active model, /models lists common model names, /continue resumes from the current transcript, /clear resets the current chat transcript, /help shows this message.',
    };
  }

  if (trimmed === '/models') {
    return {
      handled: true,
      kind: 'message',
      message: `Common model choices: ${knownModels.join(', ')}`,
    };
  }

  if (trimmed === '/model') {
    return {
      handled: true,
      kind: 'message',
      message: `Current model: ${args.activeModel}`,
    };
  }

  if (trimmed.startsWith('/model ')) {
    const nextModel = trimmed.slice('/model '.length).trim();
    if (!nextModel) {
      return {
        handled: true,
        kind: 'message',
        message: 'Usage: /model <name>',
      };
    }

    args.setActiveModel(nextModel);
    return {
      handled: true,
      kind: 'message',
      message:
        knownModels.includes(nextModel) ?
          `Switched model to ${nextModel}`
        : `Switched model to ${nextModel}. This name is not in Heddle's common shortlist, so the next API call will fail if the provider does not recognize it.`,
    };
  }

  if (trimmed === '/clear') {
    args.clearConversation();
    return {
      handled: true,
      kind: 'message',
      message: 'Cleared the current chat transcript.',
    };
  }

  if (trimmed === '/continue') {
    return {
      handled: true,
      kind: 'continue',
    };
  }

  return {
    handled: true,
    kind: 'message',
    message: `Unknown command: ${trimmed}. Use /help for available commands.`,
  };
}

type PromptInputProps = {
  value: string;
  isDisabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
};

function PromptInput({ value, isDisabled, placeholder, onChange, onSubmit }: PromptInputProps) {
  const [cursor, setCursor] = useState(value.length);

  useInput((input, key) => {
    if (isDisabled) {
      return;
    }

    if (key.return) {
      onSubmit(value);
      setCursor(0);
      return;
    }

    if ((key.meta && key.backspace) || (key.ctrl && input === 'u')) {
      onChange(value.slice(cursor));
      setCursor(0);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor === 0) {
        return;
      }

      onChange(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(cursor - 1);
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1));
      return;
    }

    if (key.home) {
      setCursor(0);
      return;
    }

    if (key.end) {
      setCursor(value.length);
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) {
      return;
    }

    if (!input) {
      return;
    }

    const nextInput = normalizePastedInput(input);
    onChange(value.slice(0, cursor) + nextInput + value.slice(cursor));
    setCursor(cursor + nextInput.length);
  }, { isActive: !isDisabled });

  if (!value) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return <Text>{buildPromptViewport(value, cursor)}</Text>;
}

function normalizePastedInput(input: string): string {
  return input.replace(/\r?\n+/g, ' ');
}

function buildPromptViewport(value: string, cursor: number): string {
  const withCursor = `${value.slice(0, cursor)}|${value.slice(cursor)}`;

  if (withCursor.length <= MAX_VISIBLE_INPUT_CHARS) {
    return withCursor;
  }

  const targetCursor = cursor + 1;
  const half = Math.floor(MAX_VISIBLE_INPUT_CHARS / 2);
  let start = Math.max(0, targetCursor - half);
  let end = Math.min(withCursor.length, start + MAX_VISIBLE_INPUT_CHARS);

  if (end - start < MAX_VISIBLE_INPUT_CHARS) {
    start = Math.max(0, end - MAX_VISIBLE_INPUT_CHARS);
  }

  const prefix = start > 0 ? '…' : '';
  const suffix = end < withCursor.length ? '…' : '';
  const slice = withCursor.slice(start, end);
  return `${prefix}${slice}${suffix}`;
}
