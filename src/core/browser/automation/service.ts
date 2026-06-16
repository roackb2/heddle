import {
  AgentSkillService,
  BROWSER_AUTOMATION_SKILL_FILE_PATH,
  BROWSER_AUTOMATION_SKILL_NAME,
  FileAgentSkillActivationRepository,
} from '@/core/skills/index.js';
import { BrowserProfileSettingsService } from '../settings/index.js';
import { BrowserProfileWindowService } from '../profile-windows/index.js';
import type {
  BrowserAutomationOverview,
  BrowserAutomationProfileOpenInput,
  BrowserAutomationProfileWindowResult,
  BrowserAutomationServiceOptions,
  BrowserAutomationSetEnabledResult,
  BrowserAutomationSettingsUpdateInput,
  BrowserAutomationSettingsUpdateResult,
} from './types.js';

/**
 * Owns the user-facing Browser Automation capability switch.
 *
 * The current capability switch intentionally persists only Agent Skill
 * activation. Browser execution policy and profile selection remain owned by
 * the browser domain/toolkit so enabling this capability does not silently
 * expand runtime permissions.
 */
export class BrowserAutomationCapabilityService {
  private readonly workspaceRoot: string;
  private readonly stateRoot: string;
  private readonly activationStore: FileAgentSkillActivationRepository;
  private readonly skills: AgentSkillService;

  static isEnabled(options: { stateRoot: string }): boolean {
    const record = new FileAgentSkillActivationRepository({ stateRoot: options.stateRoot })
      .read()
      .skills[BROWSER_AUTOMATION_SKILL_NAME];

    return record?.status === 'active'
      && record.source === 'built-in'
      && record.skillFilePath === BROWSER_AUTOMATION_SKILL_FILE_PATH;
  }

  constructor(options: BrowserAutomationServiceOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.stateRoot = options.stateRoot;
    this.activationStore = new FileAgentSkillActivationRepository({ stateRoot: this.stateRoot });
    this.skills = new AgentSkillService({
      workspaceRoot: this.workspaceRoot,
      activationStore: this.activationStore,
    });
  }

  async overview(): Promise<BrowserAutomationOverview> {
    const skill = this.skills.getBuiltInActivationView(BROWSER_AUTOMATION_SKILL_NAME);
    const browserSettings = BrowserProfileSettingsService.overview(this.stateRoot);

    return {
      enabled: skill?.status === 'active',
      skillName: BROWSER_AUTOMATION_SKILL_NAME,
      activationStorePath: FileAgentSkillActivationRepository.resolvePath(this.stateRoot),
      skill,
      browserSettings,
      profileWindow: BrowserProfileWindowService.status(this.stateRoot),
      profileRequirement: BrowserAutomationCapabilityService.profileRequirement(browserSettings),
      toolAvailability:
        'When enabled, future default agent turns include browser tools. If no explicit domain allowlist is configured, the first opened URL establishes the same-domain browsing boundary.',
    };
  }

  async updateSettings(input: BrowserAutomationSettingsUpdateInput): Promise<BrowserAutomationSettingsUpdateResult> {
    return BrowserProfileSettingsService.update(this.stateRoot, input);
  }

  private static profileRequirement(browserSettings: Awaited<ReturnType<typeof BrowserProfileSettingsService.overview>>): string {
    return browserSettings.backendSelection === 'native-chrome-cdp'
      ? `Logged-in sites require the native Chrome profile "${browserSettings.profileId}" to be open with remote debugging at ${browserSettings.cdpEndpoint ?? 'a configured local CDP endpoint'}.`
      : `Logged-in sites require a valid session in the selected Heddle browser profile "${browserSettings.profileId}". Use headed mode to log in manually.`;
  }

  async openProfileWindow(input: BrowserAutomationProfileOpenInput = {}): Promise<BrowserAutomationProfileWindowResult> {
    return await BrowserProfileWindowService.open(this.stateRoot, input);
  }

  async closeProfileWindow(): Promise<BrowserAutomationProfileWindowResult> {
    return await BrowserProfileWindowService.close(this.stateRoot);
  }

  async setEnabled(enabled: boolean): Promise<BrowserAutomationSetEnabledResult> {
    if (enabled) {
      const activation = await this.skills.activateBuiltInSkill(BROWSER_AUTOMATION_SKILL_NAME);
      if (!activation.ok) {
        return {
          ok: false,
          reason: 'skill_not_found',
          overview: await this.overview(),
        };
      }

      return {
        ok: true,
        activation,
        overview: await this.overview(),
      };
    }

    const overview = await this.overview();
    if (overview.enabled) {
      const activation = await this.skills.disableSkill(BROWSER_AUTOMATION_SKILL_NAME);
      return {
        ok: true,
        activation,
        overview: await this.overview(),
      };
    }

    return {
      ok: true,
      overview,
    };
  }
}
