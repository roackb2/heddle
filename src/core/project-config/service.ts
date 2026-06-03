import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ProjectConfig, ProjectConfigInitializeResult } from './types.js';

const CONFIG_FILE_NAME = 'heddle.config.json';
const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  model: 'gpt-5.4',
  maxSteps: 100,
  stateDir: '.heddle',
  directShellApproval: 'never',
  searchIgnoreDirs: ['.git', 'dist', 'node_modules', '.heddle'],
};

const projectConfigSchema = z.object({
  model: z.string().optional().catch(undefined),
  maxSteps: z.number().positive().finite().optional().catch(undefined),
  stateDir: z.string().optional().catch(undefined),
  directShellApproval: z.enum(['always', 'never']).optional().catch(undefined),
  searchIgnoreDirs: z.array(z.string()).optional().catch(undefined),
  agentContextPaths: z.array(z.string()).optional().catch(undefined),
}).strip();

/**
 * Owns `heddle.config.json` path resolution, parsing, defaults, and template
 * initialization. Command adapters may call the public methods here; they
 * should not duplicate config defaults or validation policy.
 */
export class ProjectConfigService {
  static resolvePath(workspaceRoot: string): string {
    return resolve(workspaceRoot, CONFIG_FILE_NAME);
  }

  static read(workspaceRoot: string): ProjectConfig {
    const configPath = ProjectConfigService.resolvePath(workspaceRoot);
    if (!existsSync(configPath)) {
      return {};
    }

    try {
      return ProjectConfigService.parse(readFileSync(configPath, 'utf8'));
    } catch {
      return {};
    }
  }

  static initialize(workspaceRoot: string): ProjectConfigInitializeResult {
    const configPath = ProjectConfigService.resolvePath(workspaceRoot);
    if (existsSync(configPath)) {
      return {
        created: false,
        configPath,
        config: ProjectConfigService.read(workspaceRoot),
      };
    }

    writeFileSync(configPath, `${JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2)}\n`);
    return {
      created: true,
      configPath,
      config: DEFAULT_PROJECT_CONFIG,
    };
  }

  private static parse(raw: string): ProjectConfig {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(projectConfigSchema.parse(parsed)).filter(([, value]) => value !== undefined),
    ) as ProjectConfig;
  }
}
