import { rememberedApprovalPolicy } from '../../../core/approvals/default-policies.js';
import { humanApprovalPolicy, requestToolApproval } from '../../../core/approvals/surface.js';
import type { ToolApprovalPolicy } from '../../../core/approvals/types.js';
import type { ChatTurnApprovalPort } from '../../../core/chat/engine/turns/host-bridge.js';
import { previewEditFileInput } from '../../../core/tools/toolkits/coding-files/edit-file.js';
import { createProjectApprovalRuleForCall, describeProjectApprovalRule } from '../state/approval-rules.js';
import type { ActionState } from './useAgentRun.js';

type TuiApprovalCall = Parameters<NonNullable<ChatTurnApprovalPort['requestToolApproval']>>[0]['call'];

export function createTuiToolApprovalPort(args: {
  state: ActionState;
  rememberProjectApproval: (call: TuiApprovalCall) => void;
}): ChatTurnApprovalPort {
  const { state, rememberProjectApproval } = args;

  return {
    async requestToolApproval(request: Parameters<NonNullable<ChatTurnApprovalPort['requestToolApproval']>>[0]) {
      if (!request) {
        return { approved: false, reason: 'Missing approval request.' };
      }
      const { call, tool } = request;
      const decision = await humanApprovalPolicy(async () => {
        const editPreview = call.tool === 'edit_file' ? await previewEditFileInput(call.input) : undefined;

        return await requestToolApproval({
          call,
          tool,
          storePending: ({ resolve }) => {
            const rememberedRule = createProjectApprovalRuleForCall(call);
            state.setPendingApproval({
              call,
              tool,
              editPreview,
              rememberForProject: () => rememberProjectApproval(call),
              rememberLabel: rememberedRule ? describeProjectApprovalRule(rememberedRule) : undefined,
              resolve,
            });
          },
        });
      })({ call, tool });
      return {
        approved: decision?.type === 'allow',
        reason: decision?.reason,
      };
    },
  };
}

export function createTuiRememberedApprovalPolicies(args: {
  isProjectApproved: (call: TuiApprovalCall) => boolean;
}): ToolApprovalPolicy[] {
  return [
    rememberedApprovalPolicy({
      isApproved: ({ call }) => args.isProjectApproved(call),
    }),
  ];
}
