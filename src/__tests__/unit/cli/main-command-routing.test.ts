import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI command routing', () => {
  it('routes the default chat command to cli-v2 and keeps the v1 escape hatch', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toMatch(/\.command\('chat'\)[\s\S]*?await ChatCliV2CommandEdgeService\.run\(resolved\);/);
    expect(source).toMatch(/\.command\('chat-v1'\)[\s\S]*?startChatCli\(\{/);
    expect(source).toContain(".command('chat-v2')");
    expect(source).toMatch(/program\s*\n\s*\.action\([\s\S]*?await ChatCliV2CommandEdgeService\.run\(resolved\);/);
  });

  it('keeps explicit chat commands out of the ask shortcut', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toMatch(/return \[[^\]]*'chat-v1'[^\]]*'chat-v2'[^\]]*\]\.includes\(command\)/s);
  });

  it('delegates auth and init command policy to cli-v2/core owners', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toContain("import { AuthCliCommandEdgeService } from '@/cli-v2/commands/auth-command.js';");
    expect(source).toContain("import { InitCliV2CommandEdgeService } from '@/cli-v2/commands/init-command.js';");
    expect(source).toContain("import { ProjectConfigService } from '@/core/project-config/index.js';");
    expect(source).toContain('InitCliV2CommandEdgeService.run({ workspaceRoot: resolved.workspaceRoot });');
    expect(source).toContain('const projectConfig = ProjectConfigService.read(workspaceRoot);');
    expect(source).not.toContain("from './auth.js'");
    expect(source).not.toContain('function initializeProjectConfig');
    expect(source).not.toContain('function loadProjectConfig');
  });

  it('routes ask through the cli-v2 API-backed command owner', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toContain("import { AskCliV2CommandEdgeService } from '@/cli-v2/commands/ask-command.js';");
    expect(source).toMatch(/\.command\('ask \[goal\.\.\.\]'\)[\s\S]*?await AskCliV2CommandEdgeService\.run\(goalParts\.join\(' '\)\.trim\(\), \{/);
    expect(source).toMatch(/if \(knownCommand && !isKnownCommand\(knownCommand\)[\s\S]*?await AskCliV2CommandEdgeService\.run\(argv\.join\(' '\)\.trim\(\), \{/);
    expect(source).not.toContain("from './ask.js'");
  });

  it('shows discovery help for command groups with subcommands', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toMatch(/const memoryCommand = program[\s\S]*?\.command\('memory'\)[\s\S]*?\.addHelpCommand\('help \[command\]'[\s\S]*?\.action\(\(_, command\) => \{\s*command\.outputHelp\(\);\s*\}\);/);
    expect(source).toMatch(/memoryCommand\s*\n\s*\.command\('status'\)[\s\S]*?await MemoryCliV2CommandEdgeService\.run\('status', resolved\);/);
  });
});
