import { parse as parseYaml } from 'yaml';
import { CustomAgentFrontmatterSchema } from './schemas.js';
import type { CustomAgentDefinition, CustomAgentSourceKind } from './types.js';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export class CustomAgentParser {
  /**
   * Converts an AGENT.md definition into the core custom-agent contract.
   */
  static parseMarkdown(input: {
    content: string;
    source: CustomAgentSourceKind;
    definitionPath?: string;
  }): CustomAgentDefinition {
    const match = FRONTMATTER_PATTERN.exec(input.content);
    if (!match) {
      throw new Error('Custom agent definitions must start with YAML frontmatter.');
    }

    const frontmatter = CustomAgentFrontmatterSchema.parse(parseYaml(match[1] ?? ''));
    const promptAppendix = (match[2] ?? '').trim();
    if (!promptAppendix && frontmatter.id !== 'builtin:code') {
      throw new Error('Custom agent prompt body cannot be empty.');
    }

    return {
      ...frontmatter,
      source: input.source,
      definitionPath: input.definitionPath,
      promptAppendix,
    };
  }
}
