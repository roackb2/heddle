import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { AutopilotProfile } from '../autonomy/index.js';
import { ToolApprovalPolicies } from '../policies.js';
import type { ToolApprovalProfile } from './types.js';

const MUTATION_CAPABILITIES = new Set([
  'workspace.write',
  'shell.mutate',
  'memory.write',
  'artifact.write',
  'browser.action',
]);

/**
 * Compiles custom-agent approval profiles into the existing ordered policy chain.
 */
export class ToolApprovalProfileService {
  static compile(input: {
    profile?: ToolApprovalProfile;
    autoProfile?: AutopilotProfile;
    basePolicies?: ToolApprovalPolicy[];
  }): ToolApprovalPolicy[] {
    const profilePolicies = ToolApprovalProfileService.profilePolicies({
      profile: input.profile,
      autoProfile: input.autoProfile,
    });
    return [
      ...profilePolicies,
      ...(input.basePolicies ?? []),
    ];
  }

  private static profilePolicies(input: {
    profile?: ToolApprovalProfile;
    autoProfile?: AutopilotProfile;
  }): ToolApprovalPolicy[] {
    const preset = input.profile?.preset ?? 'interactive';
    if (preset === 'auto' && input.autoProfile) {
      return [ToolApprovalPolicies.autopilot({ profile: input.autoProfile })];
    }

    return preset === 'read_only'
      ? [ToolApprovalProfileService.denyMutationCapabilities()]
      : [];
  }

  private static denyMutationCapabilities(): ToolApprovalPolicy {
    return ({ tool }) => {
      const capabilities = tool.capabilities ?? [];
      return capabilities.some((capability) => MUTATION_CAPABILITIES.has(capability))
        ? { type: 'deny', reason: `${tool.name} is not available to read-only agents` }
        : undefined;
    };
  }
}
