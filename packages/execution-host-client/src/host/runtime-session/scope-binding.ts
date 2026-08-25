import { createHash } from 'node:crypto';
import type { ExecutionScope } from '../../contracts/index.js';
import { RuntimeScopeMismatchError } from './errors.js';

export type RuntimeScopeBinding = ExecutionScope & {
  runtimeSessionId: string;
};

export type BoundRuntimeScope = {
  binding: RuntimeScopeBinding;
  scopeKey: string;
  executionSessionId: string;
};

/** Defense in depth if a host process is reused across execution scopes. */
export class RuntimeScopeBindingService {
  private bound?: BoundRuntimeScope;

  bind(input: RuntimeScopeBinding): BoundRuntimeScope {
    const candidate = RuntimeScopeBindingService.toBoundScope(input);
    if (!this.bound) {
      this.bound = candidate;
      return candidate;
    }

    if (this.bound.scopeKey !== candidate.scopeKey) {
      throw new RuntimeScopeMismatchError(
        'This runtime process is already bound to a different execution scope.',
      );
    }

    return this.bound;
  }

  current(): BoundRuntimeScope | undefined {
    return this.bound;
  }

  private static toBoundScope(binding: RuntimeScopeBinding): BoundRuntimeScope {
    const scopeKey = createHash('sha256')
      .update(JSON.stringify([
        binding.runtimeSessionId,
        binding.adopterId,
        binding.tenantId,
        binding.subjectId,
        binding.productSessionId,
      ]))
      .digest('hex');

    return {
      binding: { ...binding },
      scopeKey,
      executionSessionId: `runtime-${scopeKey}`,
    };
  }
}
