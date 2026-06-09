import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentSkillService, BROWSER_AUTOMATION_SKILL_NAME, FileAgentSkillActivationRepository } from '@/core/skills/index.js';
import { createReadAgentSkillTool } from '@/core/tools/toolkits/agent-skills/index.js';

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

    const service = new AgentSkillService({ workspaceRoot, homeDir, builtInSkills: [] });
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

    const service = new AgentSkillService({ workspaceRoot, homeDir: join(root, 'home'), builtInSkills: [] });
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

  it('escapes catalog prompt values and keeps resource links inside skill resource folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-parser-'));
    const workspaceRoot = join(root, 'workspace');

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'browser-research'),
      `---
name: browser-research
description: Research <browser> & "pages".
---
# Browser Research

Use [checklist](./references/browser-checklist.md), ignore [external](https://example.com), and ignore [escape](../secret.md).
`,
    );

    const service = new AgentSkillService({ workspaceRoot, homeDir: join(root, 'home'), builtInSkills: [] });
    const catalog = await service.loadCatalog();
    const prompt = service.formatCatalogPrompt(catalog);
    const result = await service.readSkill('browser-research');

    expect(prompt).toContain('Research &lt;browser&gt; &amp; &quot;pages&quot;.');
    expect(result?.resources).toEqual([
      {
        name: 'checklist',
        path: 'references/browser-checklist.md',
      },
    ]);
  });

  it('reports unsupported frontmatter fields as invalid skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-unknown-field-'));
    const workspaceRoot = join(root, 'workspace');

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'invalid-skill'),
      `---
name: invalid-skill
description: Invalid skill.
extra-field: not-standard
---
# Invalid
`,
    );

    const catalog = await new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
      builtInSkills: [],
    }).loadCatalog();

    expect(catalog.skills).toEqual([]);
    expect(catalog.issues).toEqual([
      expect.objectContaining({
        code: 'invalid_skill',
        message: expect.stringContaining('Unsupported Agent Skill frontmatter field(s): extra-field'),
      }),
    ]);
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

    const catalog = await new AgentSkillService({ workspaceRoot, homeDir, builtInSkills: [] }).loadCatalog();

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
      builtInSkills: [],
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

  it('stores workspace activation metadata and filters the active catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-activation-'));
    const workspaceRoot = join(root, 'workspace');
    const stateRoot = join(workspaceRoot, '.heddle');
    const activationStore = new FileAgentSkillActivationRepository({ stateRoot });

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'browser-research'),
      `---
name: browser-research
description: Research web pages through a browser.
---
# Browser Research

This body must not be copied into activation state.
`,
    );
    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'summarize-notes'),
      `---
name: summarize-notes
description: Summarize local notes.
---
# Summarize Notes
`,
    );

    const service = new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
      builtInSkills: [],
      activationStore,
    });

    await expect(service.loadActivatedCatalog()).resolves.toMatchObject({
      skills: [],
      issues: [],
    });

    const activatedAt = new Date('2026-06-08T10:00:00.000Z');
    await expect(service.activateSkill('browser-research', activatedAt))
      .resolves
      .toMatchObject({
        ok: true,
        record: {
          name: 'browser-research',
          status: 'active',
          source: 'project',
          activatedAt: activatedAt.toISOString(),
          updatedAt: activatedAt.toISOString(),
        },
      });

    const stored = activationStore.read();
    expect(stored.skills['browser-research']).toMatchObject({
      name: 'browser-research',
      status: 'active',
      skillFilePath: expect.stringContaining('browser-research/SKILL.md'),
    });
    expect(JSON.stringify(stored)).not.toContain('This body must not be copied into activation state.');

    await expect(service.loadActivatedCatalog()).resolves.toMatchObject({
      skills: [
        expect.objectContaining({
          name: 'browser-research',
        }),
      ],
      issues: [],
    });
  });

  it('disables activated skills without deleting their consent history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-disable-'));
    const workspaceRoot = join(root, 'workspace');
    const activationStore = new FileAgentSkillActivationRepository({
      stateRoot: join(workspaceRoot, '.heddle'),
    });
    const service = new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
      builtInSkills: [],
      activationStore,
    });

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'browser-research'),
      `---
name: browser-research
description: Research web pages through a browser.
---
# Browser Research
`,
    );

    const activatedAt = new Date('2026-06-08T10:00:00.000Z');
    const disabledAt = new Date('2026-06-08T11:00:00.000Z');

    await service.activateSkill('browser-research', activatedAt);
    await expect(service.disableSkill('browser-research', disabledAt))
      .resolves
      .toMatchObject({
        ok: true,
        record: {
          name: 'browser-research',
          status: 'disabled',
          activatedAt: activatedAt.toISOString(),
          updatedAt: disabledAt.toISOString(),
        },
      });

    await expect(service.loadActivatedCatalog()).resolves.toMatchObject({
      skills: [],
      issues: [],
    });
    await expect(service.listActivationViews()).resolves.toEqual([
      expect.objectContaining({
        name: 'browser-research',
        status: 'disabled',
        catalogEntry: expect.objectContaining({ name: 'browser-research' }),
        record: expect.objectContaining({ status: 'disabled' }),
      }),
    ]);
  });

  it('lets the read tool load active skills only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-tool-'));
    const workspaceRoot = join(root, 'workspace');
    const stateRoot = join(workspaceRoot, '.heddle');
    const service = new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
      builtInSkills: [],
      activationStore: new FileAgentSkillActivationRepository({ stateRoot }),
    });
    const tool = createReadAgentSkillTool({ workspaceRoot, stateRoot });

    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', 'browser-research'),
      `---
name: browser-research
description: Research web pages through a browser.
---
# Browser Research

Use [browser checklist](references/browser-checklist.md) before making claims.
`,
    );
    await mkdir(join(workspaceRoot, '.agents', 'skills', 'browser-research', 'references'), { recursive: true });
    await writeFile(
      join(workspaceRoot, '.agents', 'skills', 'browser-research', 'references', 'browser-checklist.md'),
      '# Browser Checklist\n\nUse browser_snapshot before making claims.\n',
      'utf8',
    );

    await expect(tool.execute({ name: 'browser-research' })).resolves.toMatchObject({
      ok: false,
      error: 'Agent Skill is not active or was not found: browser-research',
    });

    await service.activateSkill('browser-research', new Date('2026-06-08T10:00:00.000Z'));
    await expect(tool.execute({ name: 'browser-research' })).resolves.toMatchObject({
      ok: true,
      output: {
        name: 'browser-research',
        source: 'project',
        body: expect.stringContaining('Use [browser checklist]'),
        resources: [{ name: 'browser checklist', path: 'references/browser-checklist.md' }],
      },
    });
    await expect(tool.execute({
      name: 'browser-research',
      resource: 'references/browser-checklist.md',
    })).resolves.toMatchObject({
      ok: true,
      output: {
        name: 'browser-research',
        resource: { name: 'browser checklist', path: 'references/browser-checklist.md' },
        content: expect.stringContaining('Use browser_snapshot before making claims.'),
      },
    });
  });

  it('reports activation requests for unknown or inactive skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-activation-errors-'));
    const workspaceRoot = join(root, 'workspace');
    const service = new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
      activationStore: new FileAgentSkillActivationRepository({
        stateRoot: join(workspaceRoot, '.heddle'),
      }),
    });

    await expect(service.activateSkill('missing-skill')).resolves.toEqual({
      ok: false,
      reason: 'skill_not_found',
      name: 'missing-skill',
    });
    await expect(service.disableSkill('missing-skill')).resolves.toEqual({
      ok: false,
      reason: 'skill_not_active',
      name: 'missing-skill',
    });
  });

  it('discovers the built-in browser automation skill without activating it by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-built-in-'));
    const workspaceRoot = join(root, 'workspace');
    const activationStore = new FileAgentSkillActivationRepository({
      stateRoot: join(workspaceRoot, '.heddle'),
    });
    const service = new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
      activationStore,
    });

    await expect(service.loadCatalog()).resolves.toMatchObject({
      skills: [
        expect.objectContaining({
          name: BROWSER_AUTOMATION_SKILL_NAME,
          source: 'built-in',
          description: expect.stringContaining('use a browser'),
        }),
      ],
      issues: [],
    });
    await expect(service.loadActivatedCatalog()).resolves.toMatchObject({
      skills: [],
      issues: [],
    });

    await service.activateSkill(BROWSER_AUTOMATION_SKILL_NAME, new Date('2026-06-09T00:00:00.000Z'));
    await expect(service.readActivatedSkill(BROWSER_AUTOMATION_SKILL_NAME)).resolves.toMatchObject({
      skill: {
        name: BROWSER_AUTOMATION_SKILL_NAME,
        source: 'built-in',
      },
      body: expect.stringContaining('## When To Use It'),
    });
  });

  it('reads an activated built-in skill by stored source and path when a project skill shadows the name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-agent-skill-shadowed-built-in-'));
    const workspaceRoot = join(root, 'workspace');
    const activationStore = new FileAgentSkillActivationRepository({
      stateRoot: join(workspaceRoot, '.heddle'),
    });
    await writeSkill(
      join(workspaceRoot, '.agents', 'skills', BROWSER_AUTOMATION_SKILL_NAME),
      `---
name: ${BROWSER_AUTOMATION_SKILL_NAME}
description: Shadowed project skill
---
# Shadowed

Do not use browser automation.
`,
    );
    const service = new AgentSkillService({
      workspaceRoot,
      homeDir: join(root, 'home'),
      activationStore,
    });

    await expect(service.loadCatalog()).resolves.toMatchObject({
      skills: [
        expect.objectContaining({
          name: BROWSER_AUTOMATION_SKILL_NAME,
          source: 'project',
        }),
      ],
      issues: [
        expect.objectContaining({ code: 'duplicate_skill' }),
      ],
    });

    await expect(service.activateBuiltInSkill(BROWSER_AUTOMATION_SKILL_NAME, new Date('2026-06-09T00:00:00.000Z')))
      .resolves
      .toMatchObject({
        ok: true,
        record: {
          name: BROWSER_AUTOMATION_SKILL_NAME,
          source: 'built-in',
        },
      });
    await expect(service.loadActivatedCatalog()).resolves.toMatchObject({
      skills: [
        expect.objectContaining({
          name: BROWSER_AUTOMATION_SKILL_NAME,
          source: 'built-in',
        }),
      ],
    });
    await expect(service.readActivatedSkill(BROWSER_AUTOMATION_SKILL_NAME)).resolves.toMatchObject({
      skill: {
        name: BROWSER_AUTOMATION_SKILL_NAME,
        source: 'built-in',
      },
      body: expect.stringContaining('Use browser automation when'),
    });
  });
});

async function writeSkill(skillRoot: string, content: string): Promise<void> {
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, 'SKILL.md'), content, 'utf8');
}
