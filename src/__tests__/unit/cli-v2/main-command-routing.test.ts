import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI_MAIN_PATH = join(process.cwd(), 'src', 'cli-v2', 'main.ts');

describe('CLI command routing', () => {
  it('routes the default chat command to cli-v2 and blocks the removed v1 escape hatch', () => {
    const source = readFileSync(CLI_MAIN_PATH, 'utf8');

    expect(source).toMatch(/\.command\('chat'\)[\s\S]*?await ChatCliV2CommandEdgeService\.run\(resolved\);/);
    expect(source).toContain(".command('chat-v2')");
    expect(source).toMatch(/program\s*\n\s*\.action\([\s\S]*?await ChatCliV2CommandEdgeService\.run\(resolved\);/);
    expect(source).toContain("['chat-v1', 'heddle chat-v1 has been removed from the public CLI.");
    expect(source).not.toContain("from './chat/index.js'");
    expect(source).not.toContain(".command('chat-v1')");
    expect(source).not.toContain('startChatCli');
  });

  it('keeps explicit chat commands out of the ask shortcut', () => {
    const source = readFileSync(CLI_MAIN_PATH, 'utf8');
    const knownCommandsLine = source
      .split('\n')
      .find((line) => line.includes('const KNOWN_COMMANDS = new Set('));

    expect(source).toMatch(/const removedCommandMessage = knownCommand \? REMOVED_COMMAND_MESSAGES\.get\(knownCommand\) : undefined;/);
    expect(source).toContain("const KNOWN_COMMANDS = new Set(['chat', 'chat-v2', 'ask', 'init', 'memory', 'auth', 'eval', 'heartbeat', 'daemon', 'help']);");
    expect(source).toContain('return KNOWN_COMMANDS.has(command);');
    expect(knownCommandsLine).not.toContain("'chat-v1'");
  });

  it('removes repo development scripts for the legacy terminal UI route', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };

    expect(Object.keys(packageJson.scripts).filter((name) => name.startsWith('chat:dev:v1'))).toEqual([]);
    expect(Object.values(packageJson.scripts).filter((script) => script.includes('chat-v1'))).toEqual([]);
  });

  it('delegates auth and init command policy to cli-v2/core owners', () => {
    const source = readFileSync(CLI_MAIN_PATH, 'utf8');

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
    const source = readFileSync(CLI_MAIN_PATH, 'utf8');

    expect(source).toContain("import { AskCliV2CommandEdgeService } from '@/cli-v2/commands/ask-command.js';");
    expect(source).toMatch(/\.command\('ask \[goal\.\.\.\]'\)[\s\S]*?await AskCliV2CommandEdgeService\.run\(goalParts\.join\(' '\)\.trim\(\), \{/);
    expect(source).toMatch(/if \(knownCommand && !isKnownCommand\(knownCommand\)[\s\S]*?await AskCliV2CommandEdgeService\.run\(argv\.join\(' '\)\.trim\(\), \{/);
    expect(source).not.toContain("from './ask.js'");
  });

  it('shows discovery help for command groups with subcommands', () => {
    const source = readFileSync(CLI_MAIN_PATH, 'utf8');

    expect(source).toMatch(/const memoryCommand = program[\s\S]*?\.command\('memory'\)[\s\S]*?\.addHelpCommand\('help \[command\]'[\s\S]*?\.action\(\(\) => \{\s*memoryCommand\.outputHelp\(\);\s*\}\);/);
    expect(source).toMatch(/memoryCommand\s*\n\s*\.command\('status'\)[\s\S]*?await MemoryCliV2CommandEdgeService\.run\('status', resolved\);/);
    expect(source).toMatch(/const authCommand = program[\s\S]*?\.command\('auth'\)[\s\S]*?\.action\(\(\) => \{\s*authCommand\.outputHelp\(\);\s*\}\);/);
    expect(source).toMatch(/authCommand\s*\n\s*\.command\('status'\)[\s\S]*?await AuthCliCommandEdgeService\.run\('status'\);/);
  });
});
