import get from 'lodash/get.js';
import set from 'lodash/set.js';
import type {
  McpHostAutoResultArtifactHint,
  McpHostResultArtifactRule,
} from './types.js';

/**
 * Owns the path vocabulary used when compacting MCP result payloads.
 *
 * Public options may use dot paths such as `structuredContent.result.html`,
 * while internal services work with normalized string arrays. Keep path
 * matching and mutation here so artifact capture behavior remains auditable.
 */
export class McpArtifactPathService {
  static normalize(path: string | readonly string[]): string[] {
    return typeof path === 'string'
      ? path.split('.').map((part) => part.trim()).filter((part) => part.length > 0)
      : [...path];
  }

  static get(value: unknown, path: string[]): unknown {
    return get(value, path);
  }

  static set(output: unknown, path: string[], value: unknown): void {
    set(output as object, path, value);
  }

  static outputReplacementPaths(rule: McpHostResultArtifactRule, path: string[]): string[][] {
    const replacementPaths = (rule.replacePaths ?? [])
      .map((candidate) => McpArtifactPathService.normalize(candidate))
      .filter((candidate) => candidate.length > 0);

    return [path, ...replacementPaths];
  }

  static matchesHint(hint: McpHostAutoResultArtifactHint, path: string[]): boolean {
    const normalizedPath = path.join('.').toLowerCase();
    const exactPath = hint.path ? McpArtifactPathService.normalize(hint.path).join('.').toLowerCase() : undefined;
    if (exactPath && normalizedPath === exactPath) {
      return true;
    }

    const includes = hint.pathIncludes === undefined
      ? []
      : Array.isArray(hint.pathIncludes)
        ? hint.pathIncludes
        : [hint.pathIncludes];
    return includes.length > 0 && includes.every((part) => normalizedPath.includes(part.toLowerCase()));
  }

  static isArtifactReferencePath(path: string[]): boolean {
    return path.includes('artifact') || path.includes('contentPath') || path.includes('omittedCharacters');
  }
}
