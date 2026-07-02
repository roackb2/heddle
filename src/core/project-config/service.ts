import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { AUTONOMY_PERMISSION_MODES, AutopilotProfileSchema } from '@/core/approvals/autonomy/index.js';
import type { ProjectConfig, ProjectConfigInitializeResult } from './types.js';

const LOCAL_CONFIG_DIR_NAME = '.heddle';
const CONFIG_FILE_NAME = 'config.json';
// Legacy-only fallback for workspaces initialized before config moved under
// `.heddle/`. Remove this constant together with `resolveReadablePath` once
// root-level `heddle.config.json` compatibility is no longer supported.
const LEGACY_ROOT_CONFIG_FILE_NAME = 'heddle.config.json';
const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  model: 'gpt-5.4',
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
  permissionMode: z.enum(AUTONOMY_PERMISSION_MODES).optional().catch(undefined),
  autoTrustedRoots: z.array(z.string().min(1)).optional().catch(undefined),
  autopilot: AutopilotProfileSchema.optional().catch(undefined),
}).strip();

/**
 * Owns `.heddle/config.json` path resolution, parsing, defaults, and template
 * initialization. Command adapters may call the public methods here; they
 * should not duplicate config defaults or validation policy.
 */
export class ProjectConfigService {
  static resolvePath(workspaceRoot: string): string {
    return resolve(workspaceRoot, LOCAL_CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  }

  static read(workspaceRoot: string): ProjectConfig {
    const configPath = ProjectConfigService.resolveReadablePath(workspaceRoot);
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

    // Legacy-only migration: if an old root-level `heddle.config.json` exists,
    // copy its supported values into the new local `.heddle/config.json`.
    // Remove this read-based migration when legacy root config support is
    // retired.
    const config = ProjectConfigService.read(workspaceRoot);
    const template = Object.keys(config).length > 0 ? config : DEFAULT_PROJECT_CONFIG;
    mkdirSync(resolve(workspaceRoot, LOCAL_CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(template, null, 2)}\n`);
    return {
      created: true,
      configPath,
      config: template,
    };
  }

  static update(
    workspaceRoot: string,
    updater: (config: ProjectConfig) => ProjectConfig,
  ): ProjectConfig {
    const config = updater(ProjectConfigService.read(workspaceRoot));
    const configPath = ProjectConfigService.resolvePath(workspaceRoot);
    mkdirSync(resolve(workspaceRoot, LOCAL_CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(projectConfigSchema.parse(config), null, 2)}\n`);
    return ProjectConfigService.read(workspaceRoot);
  }

  private static resolveReadablePath(workspaceRoot: string): string {
    const configPath = ProjectConfigService.resolvePath(workspaceRoot);
    // Legacy-only fallback for old workspaces that still have root-level
    // `heddle.config.json`. New writes must use `resolvePath`.
    return existsSync(configPath) ? configPath : resolve(workspaceRoot, LEGACY_ROOT_CONFIG_FILE_NAME);
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
