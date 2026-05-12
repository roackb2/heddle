import type { AwarenessLimit, AwarenessSource } from './types.js';

export function formatAwarenessMetadata(args: {
  collectedAt: string;
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
}): string {
  const lines = [`Collected: ${args.collectedAt}`];

  if (args.sources.length > 0) {
    lines.push('Sources:');
    for (const source of args.sources) {
      const parts: string[] = [source.kind];
      if (source.command) {
        parts.push(`command=${source.command}`);
      }
      if (source.path) {
        parts.push(`path=${source.path}`);
      }
      if (source.note) {
        parts.push(source.note);
      }
      lines.push(`- ${parts.join('; ')}`);
    }
  }

  if (args.limits.length > 0) {
    lines.push('Limits:');
    for (const limit of args.limits) {
      lines.push(`- ${limit.kind} ${limit.subject}: ${limit.detail}`);
    }
  }

  return lines.join('\n');
}
