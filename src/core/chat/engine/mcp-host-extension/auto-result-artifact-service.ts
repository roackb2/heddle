import { ArtifactService } from '@/core/artifacts/index.js';
import cloneDeep from 'lodash/cloneDeep.js';
import { McpArtifactPathService } from './artifact-path-service.js';
import { McpStructuredContentMirrorService } from './structured-content-mirror-service.js';
import { McpHostValueService } from './value-service.js';
import type { ArtifactKind } from '@/core/artifacts/index.js';
import type {
  McpAutoResultArtifactApplyInput,
  McpHostAutoResultArtifactHint,
  McpHostResultArtifactOutput,
  ResultArtifactCandidate,
} from './types.js';

/**
 * Owns heuristic artifact capture for MCP results.
 *
 * This is the beginner-friendly path behind `resultArtifacts: true`. It scans
 * large string values, classifies common formats, stores each unique payload as
 * one artifact, and replaces duplicated or serialized mirror fields with the
 * same compact artifact reference.
 */
export class McpAutoResultArtifactService {
  static apply(args: McpAutoResultArtifactApplyInput): unknown {
    const minChars = args.auto.minChars ?? 1_200;
    const outputBeforeAuto = cloneDeep(args.output);
    const originalCandidates = McpAutoResultArtifactService.findStringResultCandidates(outputBeforeAuto);
    const candidates = originalCandidates
      .filter((candidate) => candidate.content.length >= minChars)
      .filter((candidate) => !(args.excludedPaths ?? []).some((path) =>
        McpArtifactPathService.isWithin(candidate.path, path)))
      .filter((candidate) => !McpArtifactPathService.isArtifactReferencePath(candidate.path))
      .filter((candidate) => !McpStructuredContentMirrorService.isSerializedStructuredContentMirror({
        candidate,
        output: outputBeforeAuto,
      }));
    const grouped = McpAutoResultArtifactService.groupCandidatesByContent(candidates);

    grouped.forEach((group) => {
      const primary = McpAutoResultArtifactService.selectPrimary(args.auto, group);
      if (!primary) {
        return;
      }

      const hint = McpAutoResultArtifactService.resolveHint(args.auto, primary.path);
      const kind = hint.kind ?? args.auto.kind ?? McpAutoResultArtifactService.inferArtifactKind(primary);
      const extension = hint.extension ?? args.auto.extension ?? McpAutoResultArtifactService.inferArtifactExtension(kind, primary);
      const contentPath = primary.path;
      const artifact = new ArtifactService({ artifactRoot: args.context.artifactRoot, repository: args.context.artifactRepository }).saveText({
        content: primary.content,
        kind,
        domain: hint.domain ?? args.auto.domain,
        title: hint.title ?? McpAutoResultArtifactService.defaultTitle({
          extension,
          sourceTool: args.sourceTool,
          path: contentPath,
        }),
        extension,
        mimeType: hint.mimeType ?? args.auto.mimeType ?? McpAutoResultArtifactService.inferArtifactMimeType(kind),
        sessionId: args.context.sessionId,
        sourceTool: args.sourceTool,
        metadata: {
          ...(args.auto.metadata ?? {}),
          ...(hint.metadata ?? {}),
          mcpServerId: args.options.serverId,
          mcpToolName: args.toolName,
          resultPath: contentPath,
          autoCaptured: true,
        },
        setCurrent: hint.setCurrent ?? args.auto.setCurrent,
      });
      const preview = primary.content.slice(0, hint.maxPreviewChars ?? args.auto.maxPreviewChars ?? 1_000);
      const artifactOutput = {
        artifact: {
          ...artifact,
          relativePath: ArtifactService.relativeArtifactPath(args.context.artifactRoot, artifact),
        },
        contentPath,
        preview,
        omittedCharacters: Math.max(primary.content.length - preview.length, 0),
      } satisfies McpHostResultArtifactOutput;
      const replacementPaths = args.auto.replaceDuplicateContent === false
        ? [primary.path]
        : group.map((candidate) => candidate.path);

      replacementPaths.forEach((path) => McpArtifactPathService.set(args.output, path, artifactOutput));
    });
    McpStructuredContentMirrorService.replaceMirrors({
      currentOutput: args.output,
      originalOutput: outputBeforeAuto,
      candidates: originalCandidates,
    });

    return args.output;
  }

  private static findStringResultCandidates(value: unknown, path: string[] = []): ResultArtifactCandidate[] {
    if (typeof value === 'string') {
      return [{ content: value, path }];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item, index) => McpAutoResultArtifactService.findStringResultCandidates(item, [
        ...path,
        String(index),
      ]));
    }

    if (!McpHostValueService.isRecord(value)) {
      return [];
    }

    return Object.entries(value).flatMap(([key, item]) => (
      McpAutoResultArtifactService.findStringResultCandidates(item, [...path, key])
    ));
  }

  private static groupCandidatesByContent(candidates: ResultArtifactCandidate[]): ResultArtifactCandidate[][] {
    const groups = new Map<string, ResultArtifactCandidate[]>();
    candidates.forEach((candidate) => {
      groups.set(candidate.content, [...(groups.get(candidate.content) ?? []), candidate]);
    });
    return [...groups.values()];
  }

  private static resolveHint(
    auto: { hints?: readonly McpHostAutoResultArtifactHint[] },
    path: string[],
  ): McpHostAutoResultArtifactHint {
    return auto.hints?.find((hint) => McpArtifactPathService.matchesHint(hint, path)) ?? {};
  }

  private static selectPrimary(
    auto: { hints?: readonly McpHostAutoResultArtifactHint[] },
    group: ResultArtifactCandidate[],
  ): ResultArtifactCandidate | undefined {
    return group.find((candidate) => Object.keys(McpAutoResultArtifactService.resolveHint(auto, candidate.path)).length > 0)
      ?? group[0];
  }

  private static inferArtifactKind(candidate: ResultArtifactCandidate): ArtifactKind {
    const path = candidate.path.join('.').toLowerCase();
    const trimmed = candidate.content.trimStart().toLowerCase();
    if (path.includes('html') || trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
      return 'html';
    }

    if (path.includes('json') || McpHostValueService.parseJsonObject(candidate.content)) {
      return 'json';
    }

    return 'source';
  }

  private static inferArtifactExtension(kind: ArtifactKind, candidate: ResultArtifactCandidate): string {
    if (kind === 'html') {
      return 'html';
    }

    if (kind === 'json') {
      return 'json';
    }

    const path = candidate.path.join('.').toLowerCase();
    const trimmed = candidate.content.trimStart();
    return path.includes('markdown') || path.endsWith('.md') || trimmed.startsWith('#') ? 'md' : 'txt';
  }

  private static inferArtifactMimeType(kind: ArtifactKind): string {
    if (kind === 'html') {
      return 'text/html';
    }

    if (kind === 'json') {
      return 'application/json';
    }

    return 'text/plain';
  }

  private static defaultTitle(args: {
    extension: string;
    sourceTool: string;
    path: string[];
  }): string {
    const resultName = args.path[args.path.length - 1] ?? 'result';
    return `${args.sourceTool}-${resultName}.${args.extension}`;
  }
}
