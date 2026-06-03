import { ProjectConfigService } from '@/core/project-config/index.js';

export type InitCliV2CommandOptions = {
  workspaceRoot: string;
};

export function runInitCliV2Command(options: InitCliV2CommandOptions) {
  const result = ProjectConfigService.initialize(options.workspaceRoot);
  process.stdout.write(
    result.created ?
      `Created ${result.configPath}\n`
    : `.heddle/config.json already exists at ${result.configPath}\n`,
  );
}
