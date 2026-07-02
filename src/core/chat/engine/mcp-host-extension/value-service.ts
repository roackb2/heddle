/**
 * Owns safe operations over unknown MCP payload values.
 *
 * MCP servers can return arbitrary JSON-like output. The host-extension domain
 * needs one small boundary for type guards and lossy text serialization so
 * artifact services do not each invent their own unknown-value handling.
 */
export class McpHostValueService {
  static isRecord(raw: unknown): raw is Record<string, unknown> {
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  }

  static serializeArtifactContent(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }

  static parseJsonObject(content: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(content) as unknown;
      return McpHostValueService.isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
