import { PendingToolApprovalRequests, ToolApprovalPolicies } from '@/core/approvals/index.js';
import type { ToolApprovalPolicy, ToolApprovalSurface } from '@/core/approvals/types.js';
import { ProjectApprovalRules } from '@/core/approvals/remembered-rules/index.js';
import { previewEditFileInput } from '@/core/tools/toolkits/coding-files/edit-file.js';
import type { ActionState } from '../useAgentRunController.js';

type TuiApprovalCall = Parameters<ToolApprovalSurface>[0]['call'];

export function createTuiToolApprovalPort(args: {
  state: ActionState;
  rememberProjectApproval: (call: TuiApprovalCall) => void;
}): { requestToolApproval: ToolApprovalSurface } {
  const { state, rememberProjectApproval } = args;

  return {
    async requestToolApproval(request: Parameters<ToolApprovalSurface>[0]) {
      if (!request) {
        return { approved: false, reason: 'Missing approval request.' };
      }
      const { call, tool } = request;
      const decision = await ToolApprovalPolicies.humanSurface(async () => {
        const editPreview = call.tool === 'edit_file' ? await previewEditFileInput(call.input) : undefined;

        return await PendingToolApprovalRequests.request({
          call,
          tool,
          storePending: ({ resolve }) => {
            const rememberedRule = ProjectApprovalRules.createForCall(call);
            state.setPendingApproval({
              call,
              tool,
              editPreview,
              rememberForProject: rememberedRule ? () => rememberProjectApproval(call) : undefined,
              rememberLabel: rememberedRule ? ProjectApprovalRules.describe(rememberedRule) : undefined,
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
    ToolApprovalPolicies.rememberedProjectRule({
      isApproved: ({ call }) => args.isProjectApproved(call),
    }),
  ];
}
