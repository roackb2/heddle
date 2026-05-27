import type {
  ControlPlaneApprovalDecision,
  ControlPlanePendingApproval,
} from '@/client-shared/api/types.js';

export type PendingApproval = NonNullable<ControlPlanePendingApproval>;

export type ApprovalChoice = 'approve' | 'allow_project' | 'deny';

export function resolveAvailableApprovalChoices(approval: PendingApproval): ApprovalChoice[] {
  return approval.rememberProjectApproval ? ['approve', 'allow_project', 'deny'] : ['approve', 'deny'];
}

export function resolveApprovalDecision(
  choice: ApprovalChoice,
  approval: PendingApproval,
): ControlPlaneApprovalDecision {
  if (choice === 'deny') {
    return { type: 'deny', reason: 'Denied in cli-v2' };
  }

  if (choice === 'allow_project' && approval.rememberProjectApproval) {
    return {
      type: 'approve_and_remember_project',
      reason: 'Approved and remembered for this project in cli-v2',
    };
  }

  return { type: 'approve', reason: 'Approved in cli-v2' };
}

export function resolveApprovalInputDetail(input: unknown): { label: string; value: string } | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  if (typeof record.command === 'string' && record.command.trim()) {
    return { label: 'command', value: record.command };
  }

  if (typeof record.path === 'string' && record.path.trim()) {
    return { label: 'path', value: record.path };
  }

  return undefined;
}

export function formatApprovalPayload(input: unknown, maxChars = 1200): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  const serialized = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  return serialized.length > maxChars ? `${serialized.slice(0, maxChars)}...` : serialized;
}
