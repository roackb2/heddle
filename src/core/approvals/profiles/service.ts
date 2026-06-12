import type { ToolApprovalPolicy } from '@/core/approvals/types.js';
import type { ToolApprovalProfile } from './types.js';

const MUTATION_CAPABILITIES = new Set([
  'workspace.write',
  'shell.mutate',
  'memory.write',
  'browser.action',
]);

/**
 * Compiles custom-agent approval profiles into the existing ordered policy chain.
 */
export class ToolApprovalProfileService {
  static compile(input: {
    profile?: ToolApprovalProfile;
    basePolicies?: ToolApprovalPolicy[];
  }): ToolApprovalPolicy[] {
    const profilePolicies = ToolApprovalProfileService.profilePolicies(input.profile);
    return [
      ...profilePolicies,
      ...(input.basePolicies ?? []),
    ];
  }

  private static profilePolicies(profile: ToolApprovalProfile | undefined): ToolApprovalPolicy[] {
    const preset = profile?.preset ?? 'interactive';
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
