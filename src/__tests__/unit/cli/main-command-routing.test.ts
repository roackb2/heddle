import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI command routing', () => {
  it('routes the default chat command to cli-v2 and keeps the v1 escape hatch', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toMatch(/\.command\('chat'\)[\s\S]*?await runChatCliV2Command\(resolved\);/);
    expect(source).toMatch(/\.command\('chat-v1'\)[\s\S]*?startChatCli\(\{/);
    expect(source).toContain(".command('chat-v2')");
    expect(source).toMatch(/program\s*\n\s*\.action\([\s\S]*?await runChatCliV2Command\(resolved\);/);
  });

  it('keeps explicit chat commands out of the ask shortcut', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toMatch(/return \[[^\]]*'chat-v1'[^\]]*'chat-v2'[^\]]*\]\.includes\(command\)/s);
  });

  it('delegates auth and init command policy to cli-v2/core owners', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'cli', 'main.ts'), 'utf8');

    expect(source).toContain("import { AuthCliController } from '@/cli-v2/commands/auth-command.js';");
    expect(source).toContain("import { runInitCliV2Command } from '@/cli-v2/commands/init-command.js';");
    expect(source).toContain("import { ProjectConfigService } from '@/core/project-config/index.js';");
    expect(source).toContain('runInitCliV2Command({ workspaceRoot: resolved.workspaceRoot });');
    expect(source).toContain('const projectConfig = ProjectConfigService.read(workspaceRoot);');
    expect(source).not.toContain("from './auth.js'");
    expect(source).not.toContain('function initializeProjectConfig');
    expect(source).not.toContain('function loadProjectConfig');
  });
});
