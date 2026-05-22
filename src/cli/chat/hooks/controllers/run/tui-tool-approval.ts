import { ToolApprovalPolicies, ToolApprovalService } from '@/core/approvals/index.js';
import type { ToolApprovalPolicy, ToolApprovalSurface } from '@/core/approvals/types.js';
import type { ActionState } from '../useAgentRunController.js';

export function createTuiToolApprovalPort(args: {
  state: ActionState;
  approvalService: ToolApprovalService;
}): { requestToolApproval: ToolApprovalSurface } {
  const { state, approvalService } = args;

  return {
    async requestToolApproval(request: Parameters<ToolApprovalSurface>[0]) {
      if (!request) {
        return { approved: false, reason: 'Missing approval request.' };
      }

      const { call, tool } = request;
      return await approvalService.requestHumanApproval({
        call,
        tool,
        storePending: ({ request: approvalRequest, resolve }) => {
          state.setPendingApproval({
            call,
            tool,
            editPreview: approvalRequest.editPreview,
            canRememberForProject: Boolean(approvalRequest.rememberProjectApproval),
            rememberLabel: approvalRequest.rememberProjectApproval?.label,
            resolve,
          });
        },
      });
    },
  };
}

export function createTuiRememberedApprovalPolicies(args: {
  approvalService: ToolApprovalService;
}): ToolApprovalPolicy[] {
  return [
    ToolApprovalPolicies.rememberedProjectRule({
      isApproved: (context) => args.approvalService.isApprovedByRememberedProjectRule(context),
    }),
  ];
}
