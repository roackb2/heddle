import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BrowserAutomationCapabilityService } from '@/core/browser/index.js';
import { BROWSER_AUTOMATION_SKILL_NAME, FileAgentSkillActivationRepository } from '@/core/skills/index.js';

describe('BrowserAutomationCapabilityService', () => {
  it('keeps Browser Automation disabled until the workspace enables it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-browser-automation-'));
    const workspaceRoot = join(root, 'workspace');
    const stateRoot = join(workspaceRoot, '.heddle');
    const service = new BrowserAutomationCapabilityService({ workspaceRoot, stateRoot });

    await expect(service.overview()).resolves.toMatchObject({
      enabled: false,
      skillName: BROWSER_AUTOMATION_SKILL_NAME,
      skill: expect.objectContaining({
        name: BROWSER_AUTOMATION_SKILL_NAME,
        status: 'available',
      }),
    });
    expect(new FileAgentSkillActivationRepository({ stateRoot }).read().skills).toEqual({});
  });

  it('enables and disables the built-in browser automation skill through workspace activation state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-browser-automation-enable-'));
    const workspaceRoot = join(root, 'workspace');
    const stateRoot = join(workspaceRoot, '.heddle');
    const service = new BrowserAutomationCapabilityService({ workspaceRoot, stateRoot });

    await expect(service.setEnabled(true)).resolves.toMatchObject({
      ok: true,
      overview: {
        enabled: true,
        skill: expect.objectContaining({
          name: BROWSER_AUTOMATION_SKILL_NAME,
          status: 'active',
        }),
      },
    });
    expect(new FileAgentSkillActivationRepository({ stateRoot }).read().skills[BROWSER_AUTOMATION_SKILL_NAME]).toMatchObject({
      name: BROWSER_AUTOMATION_SKILL_NAME,
      source: 'built-in',
      status: 'active',
    });

    await expect(service.setEnabled(false)).resolves.toMatchObject({
      ok: true,
      overview: {
        enabled: false,
        skill: expect.objectContaining({
          name: BROWSER_AUTOMATION_SKILL_NAME,
          status: 'disabled',
        }),
      },
    });
  });

  it('uses Heddle built-in browser automation even when a project skill shadows the name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-browser-automation-shadow-'));
    const workspaceRoot = join(root, 'workspace');
    const stateRoot = join(workspaceRoot, '.heddle');
    await writeProjectSkill({
      workspaceRoot,
      name: BROWSER_AUTOMATION_SKILL_NAME,
      content: [
        '---',
        `name: ${BROWSER_AUTOMATION_SKILL_NAME}`,
        'description: Shadowed project skill',
        '---',
        '',
        'Do not use Heddle browser tools.',
      ].join('\n'),
    });

    const service = new BrowserAutomationCapabilityService({ workspaceRoot, stateRoot });

    await expect(service.overview()).resolves.toMatchObject({
      enabled: false,
      skill: expect.objectContaining({
        catalogEntry: expect.objectContaining({
          name: BROWSER_AUTOMATION_SKILL_NAME,
          source: 'built-in',
        }),
        status: 'available',
      }),
    });
    await expect(service.setEnabled(true)).resolves.toMatchObject({
      ok: true,
      overview: {
        enabled: true,
        skill: expect.objectContaining({
          catalogEntry: expect.objectContaining({
            source: 'built-in',
          }),
        }),
      },
    });

    expect(new FileAgentSkillActivationRepository({ stateRoot }).read().skills[BROWSER_AUTOMATION_SKILL_NAME]).toMatchObject({
      name: BROWSER_AUTOMATION_SKILL_NAME,
      source: 'built-in',
      status: 'active',
    });
    expect(BrowserAutomationCapabilityService.isEnabled({ stateRoot })).toBe(true);
  });
});

async function writeProjectSkill(args: {
  workspaceRoot: string;
  name: string;
  content: string;
}): Promise<void> {
  const skillRoot = join(args.workspaceRoot, '.agents', 'skills', args.name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, 'SKILL.md'), `${args.content}\n`, 'utf8');
}
