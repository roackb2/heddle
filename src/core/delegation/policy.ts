import type {
  DelegateTaskInput,
  DelegationAgentProfileId,
  DelegationPolicy,
  DelegationPolicyInput,
  DelegationRejectionCode,
} from './types.js';

export const DEFAULT_DELEGATION_MAX_CHILDREN = 4;
export const DEFAULT_DELEGATION_MAX_CONCURRENT_CHILDREN = 3;
export const DEFAULT_DELEGATION_MAX_STEPS_PER_CHILD = 24;
export const MAX_DELEGATION_CHILDREN = 4;
export const MAX_DELEGATION_CONCURRENT_CHILDREN = 3;
export const MAX_DELEGATION_STEPS_PER_CHILD = 32;
export const MAX_DELEGATED_TASK_LENGTH = 8_000;
export const MAX_DELEGATED_SUMMARY_LENGTH = 8_000;

const SUPPORTED_AGENT_PROFILE_IDS = new Set<DelegationAgentProfileId>([
  'builtin:ask',
  'builtin:review',
]);

const DEFAULT_AGENT_PROFILE_IDS: DelegationAgentProfileId[] = [
  'builtin:ask',
  'builtin:review',
];

type DelegationRequestResolution =
  | { ok: true; input: DelegateTaskInput }
  | { ok: false; code: DelegationRejectionCode };

/**
 * Owns v1 delegation-envelope validation and request authorization.
 */
export class DelegationPolicyService {
  static resolve(input: DelegationPolicyInput = {}): DelegationPolicy {
    const allowedAgentProfileIds = [
      ...new Set(input.allowedAgentProfileIds ?? DEFAULT_AGENT_PROFILE_IDS),
    ];
    const policy = {
      enabled: input.enabled ?? false,
      maxDepth: input.maxDepth ?? 1,
      maxChildren: input.maxChildren ?? DEFAULT_DELEGATION_MAX_CHILDREN,
      maxConcurrentChildren:
        input.maxConcurrentChildren ?? DEFAULT_DELEGATION_MAX_CONCURRENT_CHILDREN,
      maxStepsPerChild:
        input.maxStepsPerChild ?? DEFAULT_DELEGATION_MAX_STEPS_PER_CHILD,
      allowedAgentProfileIds,
    };

    if (typeof policy.enabled !== 'boolean') {
      throw new TypeError('delegation enabled must be a boolean');
    }
    if (policy.maxDepth !== 1) {
      throw new RangeError('delegation maxDepth must be exactly 1 in v1');
    }
    DelegationPolicyService.assertIntegerRange(
      'maxChildren',
      policy.maxChildren,
      1,
      MAX_DELEGATION_CHILDREN,
    );
    DelegationPolicyService.assertIntegerRange(
      'maxConcurrentChildren',
      policy.maxConcurrentChildren,
      1,
      MAX_DELEGATION_CONCURRENT_CHILDREN,
    );
    if (policy.maxConcurrentChildren > policy.maxChildren) {
      throw new RangeError('delegation maxConcurrentChildren cannot exceed maxChildren');
    }
    DelegationPolicyService.assertIntegerRange(
      'maxStepsPerChild',
      policy.maxStepsPerChild,
      1,
      MAX_DELEGATION_STEPS_PER_CHILD,
    );
    if (allowedAgentProfileIds.length === 0) {
      throw new RangeError('delegation allowedAgentProfileIds must not be empty');
    }

    const unsupportedProfile = allowedAgentProfileIds.find(
      (profileId) => !SUPPORTED_AGENT_PROFILE_IDS.has(profileId as DelegationAgentProfileId),
    );
    if (unsupportedProfile) {
      throw new Error(
        `Delegation v1 only supports builtin:ask and builtin:review; received ${unsupportedProfile}`,
      );
    }

    return Object.freeze({
      ...policy,
      maxDepth: 1,
      allowedAgentProfileIds: Object.freeze(
        allowedAgentProfileIds as DelegationAgentProfileId[],
      ),
    });
  }

  static resolveRequest(input: {
    raw: unknown;
    policy: DelegationPolicy;
    parentDepth: number;
    reservedChildren: number;
    cancelled: boolean;
  }): DelegationRequestResolution {
    if (!input.policy.enabled) {
      return { ok: false, code: 'delegation_disabled' };
    }
    if (!Number.isInteger(input.parentDepth) || input.parentDepth < 0 || input.parentDepth >= input.policy.maxDepth) {
      return { ok: false, code: 'depth_limit' };
    }
    if (input.cancelled) {
      return { ok: false, code: 'cancelled' };
    }

    const parsed = DelegationPolicyService.parseTaskInput(input.raw);
    if (!parsed.ok) {
      return parsed;
    }
    if (!input.policy.allowedAgentProfileIds.includes(parsed.input.agentProfileId ?? 'builtin:ask')) {
      return { ok: false, code: 'agent_not_allowed' };
    }
    if (input.reservedChildren >= input.policy.maxChildren) {
      return { ok: false, code: 'child_limit' };
    }

    return { ok: true, input: parsed.input };
  }

  static message(code: DelegationRejectionCode): string {
    const messages: Record<DelegationRejectionCode, string> = {
      delegation_disabled: 'Delegation is disabled for this root run.',
      depth_limit: 'Delegation is limited to one child level.',
      child_limit: 'The root run has reached its total delegated-child limit.',
      agent_not_allowed: 'The requested child agent profile is not allowed.',
      agent_not_read_only: 'The requested child agent profile is not safely read-only.',
      invalid_task: `delegate_task requires a non-empty task up to ${MAX_DELEGATED_TASK_LENGTH} characters and an optional supported agentProfileId.`,
      cancelled: 'Delegated work was cancelled by the host.',
      child_failed: 'The delegated child did not complete successfully.',
    };
    return messages[code];
  }

  private static parseTaskInput(raw: unknown): DelegationRequestResolution {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, code: 'invalid_task' };
    }

    const input = raw as Record<string, unknown>;
    const allowedKeys = new Set(['task', 'agentProfileId']);
    if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
      return { ok: false, code: 'invalid_task' };
    }
    if (
      typeof input.task !== 'string'
      || !input.task.trim()
      || input.task.length > MAX_DELEGATED_TASK_LENGTH
    ) {
      return { ok: false, code: 'invalid_task' };
    }
    if (
      input.agentProfileId !== undefined
      && typeof input.agentProfileId !== 'string'
    ) {
      return { ok: false, code: 'agent_not_allowed' };
    }

    return {
      ok: true,
      input: {
        task: input.task.trim(),
        agentProfileId: input.agentProfileId as DelegationAgentProfileId | undefined,
      },
    };
  }

  private static assertIntegerRange(
    field: string,
    value: number,
    minimum: number,
    maximum: number,
  ): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new RangeError(
        `delegation ${field} must be an integer between ${minimum} and ${maximum}`,
      );
    }
  }
}
