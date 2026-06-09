import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BrowserAutomationCapabilityService, BrowserProfileSettingsService } from '@/core/browser/index.js';
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
      browserSettings: {
        profileId: 'browser-automation',
        channelSelection: 'chromium',
        displayMode: 'headless',
      },
      skill: expect.objectContaining({
        name: BROWSER_AUTOMATION_SKILL_NAME,
        status: 'available',
      }),
    });
    expect(new FileAgentSkillActivationRepository({ stateRoot }).read().skills).toEqual({});
  });

  it('persists browser profile and display settings separately from capability activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-browser-settings-'));
    const workspaceRoot = join(root, 'workspace');
    const stateRoot = join(workspaceRoot, '.heddle');
    const service = new BrowserAutomationCapabilityService({ workspaceRoot, stateRoot });

    await expect(service.updateSettings({ profileId: 'airspace-login', channel: 'chrome', headless: false })).resolves.toMatchObject({
      ok: true,
      settings: {
        profileId: 'airspace-login',
        channel: 'chrome',
        channelSelection: 'chrome',
        displayMode: 'headed',
        userDataDir: join(stateRoot, 'browser-profiles', 'airspace-login'),
      },
    });
    expect(BrowserProfileSettingsService.toolkitOptions(stateRoot)).toMatchObject({
      profileId: 'airspace-login',
      channel: 'chrome',
      headless: false,
    });
    expect(BrowserAutomationCapabilityService.isEnabled({ stateRoot })).toBe(false);
  });

  it('rejects unsafe browser profile ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-browser-settings-invalid-'));
    const workspaceRoot = join(root, 'workspace');
    const stateRoot = join(workspaceRoot, '.heddle');
    const service = new BrowserAutomationCapabilityService({ workspaceRoot, stateRoot });

    await expect(service.updateSettings({ profileId: '../real-chrome-profile' })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Profile id must start'),
      settings: {
        profileId: 'browser-automation',
      },
    });
  });

  it('falls back to defaults when the local browser settings file is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-browser-settings-invalid-json-'));
    const stateRoot = join(root, 'workspace', '.heddle');
    const settingsPath = BrowserProfileSettingsService.resolveSettingsPath(stateRoot);
    await mkdir(join(stateRoot, 'browser'), { recursive: true });
    await writeFile(settingsPath, '{not-json', 'utf8');

    expect(BrowserProfileSettingsService.overview(stateRoot)).toMatchObject({
      profileId: 'browser-automation',
      channelSelection: 'chromium',
      displayMode: 'headless',
    });
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
