export type ClientSharedApprovalInputLabels = {
  command: string;
  path: string;
};

export type ClientSharedApprovalInputDetail = {
  label: string;
  value: string;
};

const DEFAULT_LABELS: ClientSharedApprovalInputLabels = {
  command: 'command',
  path: 'path',
};

/**
 * Projects approval inputs into display-safe client metadata.
 */
export class ClientSharedApprovalDisplayService {
  static resolveInputDetail(
    input: unknown,
    labels: ClientSharedApprovalInputLabels = DEFAULT_LABELS,
  ): ClientSharedApprovalInputDetail | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }

    const record = input as Record<string, unknown>;
    if (typeof record.command === 'string' && record.command.trim()) {
      return { label: labels.command, value: record.command };
    }

    if (typeof record.path === 'string' && record.path.trim()) {
      return { label: labels.path, value: record.path };
    }

    return undefined;
  }

  static formatPayload(input: unknown, maxChars: number): string | undefined {
    if (input === undefined || input === null) {
      return undefined;
    }

    const serialized = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    return serialized.length > maxChars ? `${serialized.slice(0, maxChars)}...` : serialized;
  }
}
