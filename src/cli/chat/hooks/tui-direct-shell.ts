import { acquireSessionLease, getSessionLeaseConflict, releaseSessionLease } from '../../../core/chat/session-lease.js';
import { rememberedApprovalPolicy } from '../../../core/approvals/default-policies.js';
import { resolveToolApproval } from '../../../core/approvals/policy-chain.js';
import { summarizeToolCall } from '../../../core/observability/conversation-activity.js';
import { DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES, runShellCommand } from '../../../core/tools/toolkits/shell-process/run-shell.js';
import type { ToolCall, ToolResult } from '../../../index.js';
import { createProjectApprovalRuleForCall, describeProjectApprovalRule } from '../state/approval-rules.js';
import { readChatSession, touchSession } from '../state/storage.js';
import type { ChatSession } from '../state/types.js';
import { shouldFallbackToMutate } from '../utils/format.js';
import type { ChatRuntimeConfig } from '../utils/runtime.js';
import { beginTuiDirectShellAction, finishTuiDirectShellAction } from './tui-agent-turn-lifecycle.js';
import { finalizeTuiDirectShellSuccess } from './tui-direct-shell-result.js';
import type { ActionState } from './useAgentRun.js';
import type { ToolDefinition } from '../../../index.js';

type ActiveSessionUpdater = (updater: (session: ChatSession) => ChatSession) => void;

export async function executeTuiDirectShell(args: {
  command: string;
  shellDisplay: string;
  model: string;
  activeSessionId: string;
  activeSession: ChatSession | undefined;
  runtime: ChatRuntimeConfig;
  tools: ToolDefinition[];
  state: ActionState;
  updateActiveSession: ActiveSessionUpdater;
  maybeAutoNameSession: (sessionId: string, prompt: string, responseText: string) => void;
  isProjectApproved: (call: ToolCall) => boolean;
  rememberProjectApproval: (call: ToolCall) => void;
}) {
  const {
    command,
    shellDisplay,
    model,
    activeSessionId,
    activeSession,
    runtime,
    tools,
    state,
    updateActiveSession,
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
  } = args;

  const leaseOwner = {
    ownerKind: 'tui' as const,
    ownerId: `tui-${process.pid}`,
    clientLabel: 'terminal chat',
  };
  const persistedSession = readChatSession(runtime.sessionCatalogFile, activeSessionId, true);
  if (!persistedSession) {
    return;
  }
  const conflict = getSessionLeaseConflict(persistedSession, leaseOwner);
  if (conflict) {
    state.setError(conflict);
    state.setStatus('Blocked');
    updateActiveSession((session) => ({
      ...session,
      messages: [...session.messages, { id: state.nextLocalId(), role: 'assistant', text: conflict }],
    }));
    return;
  }
  updateActiveSession(() => touchSession(acquireSessionLease(persistedSession, leaseOwner)));
  const directShellAbortController = beginTuiDirectShellAction(state, command);
  updateActiveSession((session) => ({
    ...session,
    messages: [...session.messages, { id: state.nextLocalId(), role: 'user', text: shellDisplay }],
    lastContinuePrompt: undefined,
  }));

  try {
    const inspectCall: ToolCall = {
      id: `direct-shell-${Date.now()}-inspect`,
      tool: 'run_shell_inspect',
      input: { command },
    };
    const inspectResult = await runShellCommand(
      inspectCall.input,
      {
        toolName: inspectCall.tool,
        rules: DEFAULT_INSPECT_RULES,
        allowUnknown: false,
      },
      directShellAbortController.signal,
    );

    let chosenCall = inspectCall;
    let chosenResult: ToolResult = inspectResult;

    if (shouldFallbackToMutate(inspectResult.error)) {
      const mutateCall: ToolCall = {
        id: `direct-shell-${Date.now()}-mutate`,
        tool: 'run_shell_mutate',
        input: { command },
      };

      if (runtime.directShellApproval === 'always') {
        const directShellTool = tools.find((tool) => tool.name === 'run_shell_mutate');
        if (!directShellTool) {
          throw new Error('run_shell_mutate tool is not registered');
        }

        const approval = await resolveToolApproval({
          policies: [
            () => ({ type: 'request', reason: 'Direct shell mutation requires approval' }),
            rememberedApprovalPolicy({
              isApproved: ({ call }) => isProjectApproved(call),
            }),
          ],
          context: {
            call: mutateCall,
            tool: directShellTool,
            workspaceRoot: runtime.workspaceRoot,
          },
          requestHumanApproval: async () => await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
              const rememberedRule = createProjectApprovalRuleForCall(mutateCall);
              state.setPendingApproval({
                call: mutateCall,
                tool: directShellTool,
                rememberForProject: () => rememberProjectApproval(mutateCall),
                rememberLabel: rememberedRule ? describeProjectApprovalRule(rememberedRule) : undefined,
                resolve,
              });
            }),
        });

        if (!approval.approved) {
          const denialMessage = approval.reason ? `Command denied.\n${approval.reason}` : 'Command denied.';
          updateActiveSession((session) => ({
            ...session,
            messages: [...session.messages, { id: state.nextLocalId(), role: 'assistant', text: denialMessage }],
          }));
          state.setLiveEvents([
            {
              id: state.nextLocalId(),
              text: `approval denied for ${summarizeToolCall(mutateCall.tool, mutateCall.input)}`,
            },
          ]);
          state.setStatus('Idle');
          return;
        }
      }

      chosenCall = mutateCall;
      chosenResult = await runShellCommand(
        mutateCall.input,
        {
          toolName: mutateCall.tool,
          rules: DEFAULT_MUTATE_RULES,
          allowUnknown: true,
        },
        directShellAbortController.signal,
      );
    }

    await finalizeTuiDirectShellSuccess({
      chosenCall,
      chosenResult,
      command,
      shellDisplay,
      model,
      activeSessionId,
      activeSession: activeSession ?? persistedSession,
      runtime,
      tools,
      state,
      updateActiveSession,
      maybeAutoNameSession,
    });
  } catch (shellError) {
    const message = shellError instanceof Error ? shellError.message : String(shellError);
    state.setError(message);
    state.setStatus('Error');
    updateActiveSession((session) => ({
      ...session,
      messages: [
        ...session.messages,
        { id: state.nextLocalId(), role: 'assistant', text: `Direct shell execution failed:\n${message}` },
      ],
    }));
  } finally {
    updateActiveSession((session) => releaseSessionLease(session, leaseOwner));
    finishTuiDirectShellAction(state);
  }
}
