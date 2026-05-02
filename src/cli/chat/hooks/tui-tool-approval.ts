import { rememberedApprovalPolicy } from '../../../core/approvals/default-policies.js';
import { evaluateToolApprovalPolicies } from '../../../core/approvals/policy-chain.js';
import { humanApprovalPolicy, requestToolApproval } from '../../../core/approvals/surface.js';
import type { ChatTurnApprovalPort } from '../../../core/chat/turn-host.js';
import { previewEditFileInput } from '../../../core/tools/edit-file.js';
import { createProjectApprovalRuleForCall, describeProjectApprovalRule } from '../state/approval-rules.js';
import type { ActionState } from './useAgentRun.js';

export function createTuiToolApprovalPort(args: {
  state: ActionState;
  isProjectApproved: (call: Parameters<NonNullable<ChatTurnApprovalPort['requestToolApproval']>>[0]['call']) => boolean;
  rememberProjectApproval: (call: Parameters<NonNullable<ChatTurnApprovalPort['requestToolApproval']>>[0]['call']) => void;
}): ChatTurnApprovalPort {
  const { state, isProjectApproved, rememberProjectApproval } = args;

  return {
    async requestToolApproval(request) {
      if (!request) {
        return { approved: false, reason: 'Missing approval request.' };
      }
      const { call, tool } = request;
      const decision = await evaluateToolApprovalPolicies([
        rememberedApprovalPolicy({
          isApproved: ({ call: policyCall }) => isProjectApproved(policyCall),
        }),
        humanApprovalPolicy(async () => {
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
        }),
      ], { call, tool });
      return {
        approved: decision?.type === 'allow',
        reason: decision?.reason,
      };
    },
  };
}
