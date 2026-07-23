import type { ToolDefinition } from '@/core/types.js';
import { ToolPolicyEnvelopeInputService } from './input-service.js';
import type {
  ToolPolicyEnvelope,
  ToolPolicyHostContext,
  ToolPolicyOperation,
  ToolPolicyReconciliation,
  ToolPolicyReconciliationDiagnostic,
  ToolPolicyResolution,
} from './types.js';

const MODEL_ENVELOPE_FIELDS: Array<keyof ToolPolicyEnvelope> = [
  'operations',
  'intent',
  'targetRoots',
  'readRoots',
  'writeRoots',
  'expectedEffects',
  'maxDestructiveScope',
  'environment',
  'confidence',
];

/**
 * Reconciles a model-authored intent envelope with immutable host execution
 * facts. Approval policy consumes `effective`; traces retain both sources.
 */
export class ToolPolicyResolutionService {
  static resolve(args: {
    tool: ToolDefinition;
    input: unknown;
  }): ToolPolicyResolution {
    const extraction = ToolPolicyEnvelopeInputService.extract(args.input);
    const hostOwned = extraction.error
      ? args.tool.hostPolicy
      : ToolPolicyResolutionService.resolveHostContext(args.tool, extraction.toolInput);
    const diagnostics = ToolPolicyResolutionService.resolveDiagnostics({
      modelProposed: extraction.envelope,
      hostOwned,
    });
    const effective = ToolPolicyResolutionService.resolveEffectiveEnvelope({
      modelProposed: extraction.envelope,
      hostOwned,
    });

    return {
      ...extraction,
      envelope: effective,
      reconciliation: {
        modelProposed: extraction.envelope,
        hostOwned,
        effective,
        ownership: {
          hostOwned: [
            ...(hostOwned ? ['authority', 'transport', 'environment'] as const : []),
            ...(hostOwned?.operations ? ['operations'] as const : []),
          ],
          modelProposed: extraction.envelope
            ? MODEL_ENVELOPE_FIELDS.filter((field) => extraction.envelope?.[field] !== undefined)
            : [],
        },
        diagnostics,
      },
    };
  }

  static operations(args: {
    reconciliation: ToolPolicyReconciliation;
    fallback: ToolPolicyOperation[];
  }): ToolPolicyOperation[] {
    return [
      ...(args.reconciliation.hostOwned?.operations
        ?? args.reconciliation.effective?.operations
        ?? args.fallback),
    ];
  }

  private static resolveHostContext(
    tool: ToolDefinition,
    toolInput: unknown,
  ): ToolPolicyHostContext | undefined {
    return tool.resolveHostPolicy?.(toolInput) ?? tool.hostPolicy;
  }

  private static resolveEffectiveEnvelope(args: {
    modelProposed?: ToolPolicyEnvelope;
    hostOwned?: ToolPolicyHostContext;
  }): ToolPolicyEnvelope | undefined {
    if (!args.modelProposed) {
      return undefined;
    }

    const proposedOperations = ToolPolicyResolutionService.removeTransportOperation({
      operations: args.modelProposed.operations,
      hostOwned: args.hostOwned,
    });
    const operations = args.hostOwned?.operations
      ? [...args.hostOwned.operations]
      : proposedOperations;

    return {
      ...args.modelProposed,
      operations: operations.length > 0 ? operations : ['unknown'],
      environment: args.hostOwned?.environment ?? args.modelProposed.environment,
    };
  }

  private static removeTransportOperation(args: {
    operations: ToolPolicyOperation[];
    hostOwned?: ToolPolicyHostContext;
  }): ToolPolicyOperation[] {
    return args.hostOwned?.transport.network
      ? args.operations.filter((operation) => operation !== 'network')
      : args.operations;
  }

  private static resolveDiagnostics(args: {
    modelProposed?: ToolPolicyEnvelope;
    hostOwned?: ToolPolicyHostContext;
  }): ToolPolicyReconciliationDiagnostic[] {
    if (!args.modelProposed || !args.hostOwned) {
      return [];
    }

    return [
      ...(args.modelProposed.environment !== args.hostOwned.environment
        ? [{
            code: 'environment_overridden' as const,
            message:
              `Model proposed environment "${args.modelProposed.environment}", `
              + `but the host targets "${args.hostOwned.environment}"; host environment applied.`,
          }]
        : []),
      ...(args.hostOwned.transport.network && args.modelProposed.operations.includes('network')
        ? [{
            code: 'network_transport_normalized' as const,
            message:
              `Model proposed "network" as an operation, but ${args.hostOwned.transport.kind} `
              + 'is host-owned transport provenance; transport operation removed.',
          }]
        : []),
      ...(args.hostOwned.operations
        && !sameOperations(args.modelProposed.operations, args.hostOwned.operations)
        ? [{
            code: 'operations_overridden' as const,
            message:
              `Model proposed operations [${args.modelProposed.operations.join(', ')}], `
              + `but the host classifies this tool as [${args.hostOwned.operations.join(', ')}]; `
              + 'host operations applied.',
          }]
        : []),
    ];
  }
}

function sameOperations(
  left: readonly ToolPolicyOperation[],
  right: readonly ToolPolicyOperation[],
): boolean {
  return left.length === right.length && left.every((operation) => right.includes(operation));
}
