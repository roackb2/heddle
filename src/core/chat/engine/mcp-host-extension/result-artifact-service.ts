import { ArtifactService } from '@/core/artifacts/index.js';
import cloneDeep from 'lodash/cloneDeep.js';
import { McpArtifactPathService } from './artifact-path-service.js';
import { McpAutoResultArtifactService } from './auto-result-artifact-service.js';
import { McpHostValueService } from './value-service.js';
import type {
  McpHostResultArtifactOutput,
  McpHostResultArtifactRule,
  McpHostResultArtifactsOptions,
  McpManualResultArtifactApplyInput,
  McpResultArtifactApplyInput,
  ResolvedResultArtifactsOptions,
} from './types.js';

/**
 * Coordinates MCP result compaction before tool output is returned to the model.
 *
 * Manual rules are for known result paths. Auto capture is the beginner path:
 * `resultArtifacts: true` enables large-output artifact capture without asking
 * host authors to understand MCP result object paths.
 */
export class McpResultArtifactService {
  static apply(args: McpResultArtifactApplyInput): unknown {
    const resultArtifacts = McpResultArtifactService.resolve(args.options.resultArtifacts);
    const rules = resultArtifacts.rules
      .filter((rule) => rule.toolName === args.toolName);
    if (!rules.length && !resultArtifacts.auto) {
      return args.output;
    }

    const manuallyCaptured = rules.reduce((currentOutput, rule) => McpResultArtifactService.applyRule({
      ...args,
      output: currentOutput,
      rule,
    }), cloneDeep(args.output));
    const mirroredPaths = rules
      .filter((rule) => rule.mode === 'mirror')
      .map((rule) => McpArtifactPathService.normalize(rule.path))
      .filter((path) => path.length > 0);

    return resultArtifacts.auto
      ? McpAutoResultArtifactService.apply({
          ...args,
          auto: resultArtifacts.auto,
          excludedPaths: mirroredPaths,
          output: manuallyCaptured,
        })
      : manuallyCaptured;
  }

  private static applyRule(args: McpManualResultArtifactApplyInput): unknown {
    const path = McpArtifactPathService.normalize(args.rule.path);
    if (!path.length) {
      return args.output;
    }

    const value = McpArtifactPathService.get(args.output, path);
    if (value === undefined) {
      return args.output;
    }

    const content = McpHostValueService.serializeArtifactContent(value);
    const artifact = new ArtifactService({ artifactRoot: args.context.artifactRoot, repository: args.context.artifactRepository }).saveText({
      content,
      kind: args.rule.kind,
      domain: args.rule.domain,
      title: args.rule.title ?? McpResultArtifactService.defaultTitle({
        rule: args.rule,
        sourceTool: args.sourceTool,
        path,
      }),
      extension: args.rule.extension,
      mimeType: args.rule.mimeType,
      sessionId: args.context.sessionId,
      sourceTool: args.sourceTool,
      metadata: {
        ...(args.rule.metadata ?? {}),
        mcpServerId: args.options.serverId,
        mcpToolName: args.toolName,
        resultPath: path,
      },
      setCurrent: args.rule.setCurrent,
    });
    // Mirror mode: the artifact is persisted (above), but the value stays
    // inline so downstream tool calls can keep consuming it directly.
    if (args.rule.mode === 'mirror') {
      return args.output;
    }

    const preview = content.slice(0, args.rule.maxPreviewChars ?? 1_000);
    const artifactOutput = {
      artifact: {
        ...artifact,
        relativePath: ArtifactService.relativeArtifactPath(args.context.artifactRoot, artifact),
      },
      contentPath: path,
      preview,
      omittedCharacters: Math.max(content.length - preview.length, 0),
    } satisfies McpHostResultArtifactOutput;

    McpArtifactPathService.outputReplacementPaths(args.rule, path)
      .forEach((replacementPath) => McpArtifactPathService.set(args.output, replacementPath, artifactOutput));

    return args.output;
  }

  private static resolve(
    resultArtifacts: McpHostResultArtifactsOptions | undefined,
  ): ResolvedResultArtifactsOptions {
    if (resultArtifacts === true) {
      return { rules: [], auto: {} };
    }

    if (resultArtifacts === false || resultArtifacts === undefined) {
      return { rules: [] };
    }

    if (McpResultArtifactService.isRuleArray(resultArtifacts)) {
      return { rules: resultArtifacts };
    }

    return {
      rules: resultArtifacts.rules ?? [],
      ...(resultArtifacts.auto
        ? { auto: resultArtifacts.auto === true ? {} : resultArtifacts.auto }
        : {}),
    };
  }

  private static isRuleArray(
    resultArtifacts: Exclude<McpHostResultArtifactsOptions, boolean>,
  ): resultArtifacts is readonly McpHostResultArtifactRule[] {
    return Array.isArray(resultArtifacts);
  }

  private static defaultTitle(args: {
    rule: McpHostResultArtifactRule;
    sourceTool: string;
    path: string[];
  }): string {
    const resultName = args.path[args.path.length - 1] ?? 'result';
    const extension = args.rule.extension?.replace(/^\./, '') ?? args.rule.kind;
    return `${args.sourceTool}-${resultName}.${extension}`;
  }
}
