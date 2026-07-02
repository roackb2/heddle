import cloneDeep from 'lodash/cloneDeep.js';
import isEqual from 'lodash/isEqual.js';
import { McpArtifactPathService } from './artifact-path-service.js';
import { McpHostValueService } from './value-service.js';
import type { ResultArtifactCandidate } from './types.js';

/**
 * Detects MCP `content[].text` values that are JSON mirrors of structured output.
 *
 * Many MCP servers return both `structuredContent.result` and a serialized
 * text mirror for clients that only read `content`. Auto artifact capture should
 * compact the structured result once, then replace the mirror with the compacted
 * structured value instead of saving a second artifact.
 */
export class McpStructuredContentMirrorService {
  static isSerializedStructuredContentMirror(input: {
    candidate: ResultArtifactCandidate;
    output: unknown;
  }): boolean {
    return McpStructuredContentMirrorService.serializedStructuredContentMirrorPath(input) !== undefined;
  }

  static replaceMirrors(input: {
    currentOutput: unknown;
    originalOutput: unknown;
    candidates: ResultArtifactCandidate[];
  }): void {
    input.candidates
      .map((candidate) => ({
        candidate,
        mirrorPath: McpStructuredContentMirrorService.serializedStructuredContentMirrorPath({
          candidate,
          output: input.originalOutput,
        }),
      }))
      .filter((entry): entry is { candidate: ResultArtifactCandidate; mirrorPath: string[] } => !!entry.mirrorPath)
      .forEach((entry) => {
        const compactedMirror = McpArtifactPathService.get(input.currentOutput, entry.mirrorPath);
        if (compactedMirror !== undefined) {
          McpArtifactPathService.set(input.currentOutput, entry.candidate.path, cloneDeep(compactedMirror));
        }
      });
  }

  private static serializedStructuredContentMirrorPath(input: {
    candidate: ResultArtifactCandidate;
    output: unknown;
  }): string[] | undefined {
    if (!McpStructuredContentMirrorService.isMcpContentTextPath(input.candidate.path)) {
      return undefined;
    }

    const parsed = McpHostValueService.parseJsonObject(input.candidate.content);
    if (!parsed) {
      return undefined;
    }

    return [
      ['structuredContent'],
      ['structuredContent', 'result'],
    ].find((path) => {
      const mirroredValue = McpArtifactPathService.get(input.output, path);
      return mirroredValue !== undefined && isEqual(parsed, mirroredValue);
    });
  }

  private static isMcpContentTextPath(path: string[]): boolean {
    return path.length >= 3 && path[0] === 'content' && path[path.length - 1] === 'text';
  }
}
