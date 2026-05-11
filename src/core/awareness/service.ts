import type { AwarenessCollectInput, AwarenessProvider, AwarenessSnapshot } from './types.js';

export type AwarenessService = {
  collect<Section = unknown>(input: AwarenessCollectInput): Promise<AwarenessSnapshot<Section>>;
};

export function createAwarenessService(args: {
  providers: ReadonlyArray<AwarenessProvider>;
}): AwarenessService {
  const providersByDomain = new Map(args.providers.map((provider) => [provider.domain, provider]));

  return {
    async collect<Section = unknown>(input: AwarenessCollectInput): Promise<AwarenessSnapshot<Section>> {
      const provider = providersByDomain.get(input.domain);
      if (!provider) {
        throw new Error(`No awareness provider registered for domain: ${input.domain}`);
      }

      return provider.collect(input) as Promise<AwarenessSnapshot<Section>>;
    },
  };
}
