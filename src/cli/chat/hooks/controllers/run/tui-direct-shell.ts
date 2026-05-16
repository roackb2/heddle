import { ToolApprovalPolicies, ToolApprovalService } from '@/core/approvals/index.js';
import { ProjectApprovalRules } from '@/core/approvals/remembered-rules/index.js';
import type { ConversationSessionService } from '@/core/chat/engine/types.js';
import { summarizeToolCall } from '@/core/observability/conversation-activity.js';
import { DEFAULT_INSPECT_RULES, DEFAULT_MUTATE_RULES, runShellCommand } from '@/core/tools/toolkits/shell-process/run-shell.js';
import type { ToolCall, ToolDefinition, ToolResult } from '@/core/types.js';
import { shouldFallbackToMutate } from '../../../utils/format.js';
import type { ChatRuntimeConfig } from '../../../utils/runtime.js';
import { beginTuiDirectShellAction, finishTuiDirectShellAction } from './tui-agent-turn-lifecycle.js';
import { finalizeTuiDirectShellSuccess } from './tui-direct-shell-result.js';
import type { ActionState } from '../useAgentRunController.js';
import type { ChatSession } from '../../../state/types.js';

export async function executeTuiDirectShell(args: {
  command: string;
  shellDisplay: string;
  model: string;
  activeSessionId: string;
  activeSession: ChatSession | undefined;
  runtime: ChatRuntimeConfig;
  tools: ToolDefinition[];
  state: ActionState;
  sessionService: ConversationSessionService;
  refreshSessions: () => void;
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
    sessionService,
    refreshSessions,
    maybeAutoNameSession,
    isProjectApproved,
    rememberProjectApproval,
  } = args;

  const leaseOwner = {
    ownerKind: 'tui' as const,
    ownerId: `tui-${process.pid}`,
    clientLabel: 'terminal chat',
  };
  let persistedSession: ChatSession;
  try {
    persistedSession = sessionService.require(activeSessionId);
  } catch {
    return;
  }
  const conflict = sessionService.getLeaseConflict(activeSessionId, leaseOwner);
  if (conflict) {
    state.setError(conflict);
    state.setStatus('Blocked');
    sessionService.appendMessage(activeSessionId, {
      id: state.nextLocalId(),
      role: 'assistant',
      text: conflict,
    });
    refreshSessions();
    return;
  }
  persistedSession = sessionService.acquireLease(activeSessionId, leaseOwner);
  refreshSessions();
  const directShellAbortController = beginTuiDirectShellAction(state, command);
  sessionService.appendMessage(activeSessionId, { id: state.nextLocalId(), role: 'user', text: shellDisplay });
  sessionService.setLastContinuePrompt(activeSessionId, undefined);
  refreshSessions();

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

        const approval = await ToolApprovalService.resolve({
          policies: [
            () => ({ type: 'request', reason: 'Direct shell mutation requires approval' }),
            ToolApprovalPolicies.rememberedProjectRule({
              isApproved: ({ call }) => isProjectApproved(call),
            }),
          ],
          context: {
            call: mutateCall,
            tool: directShellTool,
            workspaceRoot: runtime.workspaceRoot,
          },
          requestHumanApproval: async () => await new Promise<{ approved: boolean; reason?: string }>((resolve) => {
              const rememberedRule = ProjectApprovalRules.createForCall(mutateCall);
              state.setPendingApproval({
                call: mutateCall,
                tool: directShellTool,
                rememberForProject: rememberedRule ? () => rememberProjectApproval(mutateCall) : undefined,
                rememberLabel: rememberedRule ? ProjectApprovalRules.describe(rememberedRule) : undefined,
                resolve,
              });
            }),
        });

        if (!approval.approved) {
          const denialMessage = approval.reason ? `Command denied.\n${approval.reason}` : 'Command denied.';
          sessionService.appendMessage(activeSessionId, {
            id: state.nextLocalId(),
            role: 'assistant',
            text: denialMessage,
          });
          refreshSessions();
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
      sessionService,
      refreshSessions,
      maybeAutoNameSession,
    });
  } catch (shellError) {
    const message = shellError instanceof Error ? shellError.message : String(shellError);
    state.setError(message);
    state.setStatus('Error');
    sessionService.appendMessage(activeSessionId, {
      id: state.nextLocalId(),
      role: 'assistant',
      text: `Direct shell execution failed:\n${message}`,
    });
    refreshSessions();
  } finally {
    sessionService.releaseLease(activeSessionId, leaseOwner);
    refreshSessions();
    finishTuiDirectShellAction(state);
  }
}
