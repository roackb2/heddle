import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentSkillService } from '@/core/skills/index.js';

describe('AgentSkillService', () => {
  it('discovers standard project and user skill catalogs without exposing skill bodies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skills-'));
    const workspaceRoot = join(root, 'workspace');
    const homeDir = join(root, 'home');

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'browser-research'),
      `---
name: browser-research
description: Research web pages through a browser.
allowed-tools: browser_open browser_snapshot
metadata:
  owner: heddle
---
# Browser Research

Do not expose this instruction in the catalog.
`,
    );
    await writeSkill(
      join(homeDir, '.agents', 'skills', 'summarize-notes'),
      `---
name: summarize-notes
description: Summarize local notes.
---
# Summarize Notes
`,
    );

    const service = new AgentSkillService({ workspaceRoot, homeDir });
    const catalog = await service.loadCatalog();

    expect(catalog.issues).toEqual([]);
    expect(catalog.skills).toEqual([
      expect.objectContaining({
        name: 'browser-research',
        description: 'Research web pages through a browser.',
        source: 'project',
        allowedTools: 'browser_open browser_snapshot',
        metadata: { owner: 'heddle' },
      }),
      expect.objectContaining({
        name: 'summarize-notes',
        description: 'Summarize local notes.',
        source: 'user',
      }),
    ]);

    const prompt = service.formatCatalogPrompt(catalog);
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('browser-research');
    expect(prompt).toContain('Research web pages through a browser.');
    expect(prompt).not.toContain('Do not expose this instruction in the catalog.');
  });

  it('reads a full skill body and resource references only on demand', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-read-'));
    const workspaceRoot = join(root, 'workspace');

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'browser-research'),
      `---
name: browser-research
description: Research web pages through a browser.
---
# Browser Research

Use the [browser checklist](references/browser-checklist.md) before checkout flows.
`,
    );

    const service = new AgentSkillService({ workspaceRoot, homeDir: join(root, 'home') });
    const result = await service.readSkill('browser-research');

    expect(result).toMatchObject({
      skill: {
        name: 'browser-research',
      },
      body: expect.stringContaining('Use the [browser checklist]'),
      resources: [{
        name: 'browser checklist',
        path: 'references/browser-checklist.md',
      }],
    });
  });

  it('keeps the first skill by source precedence and reports duplicates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-duplicates-'));
    const workspaceRoot = join(root, 'workspace');
    const homeDir = join(root, 'home');

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'research'),
      `---
name: research
description: Project-specific research skill.
---
# Project
`,
    );
    await writeSkill(
      join(homeDir, '.agents', 'skills', 'research'),
      `---
name: research
description: User-level research skill.
---
# User
`,
    );

    const catalog = await new AgentSkillService({ workspaceRoot, homeDir }).loadCatalog();

    expect(catalog.skills).toEqual([
      expect.objectContaining({
        name: 'research',
        description: 'Project-specific research skill.',
        source: 'project',
      }),
    ]);
    expect(catalog.issues).toEqual([
      expect.objectContaining({
        code: 'duplicate_skill',
        message: expect.stringContaining('Ignored duplicate Agent Skill "research"'),
      }),
    ]);
  });

  it('reports invalid skills without blocking valid catalog entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-invalid-'));
    const workspaceRoot = join(root, 'workspace');

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'valid-skill'),
      `---
name: valid-skill
description: Valid skill.
---
# Valid
`,
    );
    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'invalid-skill'),
      `---
name: Invalid Skill
---
# Invalid
`,
    );

    const catalog = await new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
    }).loadCatalog();

    expect(catalog.skills).toEqual([
      expect.objectContaining({ name: 'valid-skill' }),
    ]);
    expect(catalog.issues).toEqual([
      expect.objectContaining({
        code: 'invalid_skill',
        path: expect.stringContaining('invalid-skill/SKILL.md'),
      }),
    ]);
  });
});

async function writeSkill(skillRoot: string, content: string): Promise<void> {
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, 'SKILL.md'), content, 'utf8');
}
