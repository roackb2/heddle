import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ProjectApprovalRuleCodec } from './codec.js';
import type { ProjectApprovalRule } from './types.js';

/**
 * Owns file IO for remembered project approval rules.
 */
export class FileProjectApprovalRuleRepository {
  constructor(private readonly filePath: string) {}

  list(): ProjectApprovalRule[] {
    try {
      if (!existsSync(this.filePath)) {
        return [];
      }

      return ProjectApprovalRuleCodec.parseList(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch (error) {
      process.stderr.write(
        `Failed to load project approval rules from ${this.filePath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return [];
    }
  }

  save(rules: ProjectApprovalRule[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, ProjectApprovalRuleCodec.serialize(rules));
  }
}
