// Boundary note: this browser code only reaches into a browser-safe provider inference helper as a
// temporary bridge. Desired shape: auth/provider display state should come from the control-plane
// API, and web code should not import LLM adapter or core runtime services directly.
import { LlmProviderInference } from '../../../core/llm/registry/provider-inference.js';
import type { ControlPlaneState } from '../../lib/api';

export function formatControlPlaneAuthStatus(
  model: string | undefined,
  auth: ControlPlaneState['auth'] | undefined,
): string | undefined {
  if (!model || !auth) {
    return undefined;
  }

  const provider = LlmProviderInference.inferBuiltin(model);
  if (provider === 'openai') {
    return formatProviderSource('openai', auth.openai);
  }

  if (provider === 'anthropic') {
    return formatProviderSource('anthropic', auth.anthropic);
  }

  return undefined;
}

function formatProviderSource(
  provider: 'openai' | 'anthropic',
  source: ControlPlaneState['auth']['openai'] | ControlPlaneState['auth']['anthropic'],
): string {
  switch (source.type) {
    case 'explicit-api-key':
      return `auth=${provider}-key`;
    case 'env-api-key':
      return `auth=${provider}-key`;
    case 'oauth':
      return source.accountId ? `auth=${provider}-oauth:${source.accountId.slice(0, 8)}` : `auth=${provider}-oauth`;
    case 'missing':
      return `auth=${provider}-missing`;
  }
}
