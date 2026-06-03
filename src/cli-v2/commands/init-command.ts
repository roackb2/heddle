import { ProjectConfigService } from '@/core/project-config/index.js';

export type InitCliV2CommandOptions = {
  workspaceRoot: string;
};

/**
 * Command edge for `heddle init`.
 *
 * Owns: terminal output for project initialization.
 *
 * Does not own: config path policy, schema defaults, or legacy config
 * compatibility. Those belong to ProjectConfigService's public command-facing
 * contract.
 */
export class InitCliV2CommandEdgeService {
  static run(options: InitCliV2CommandOptions) {
    const result = ProjectConfigService.initialize(options.workspaceRoot);
    process.stdout.write(
      result.created ?
        `Created ${result.configPath}\n`
      : `.heddle/config.json already exists at ${result.configPath}\n`,
    );
  }
}
