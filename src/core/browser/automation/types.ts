import type {
  AgentSkillActivationResult,
  AgentSkillActivationView,
} from '@/core/skills/index.js';
import type {
  BrowserProfileSettingsOverview,
  BrowserProfileSettingsUpdateInput,
  BrowserProfileSettingsUpdateResult,
} from '../settings/index.js';
import type {
  BrowserProfileWindowOpenInput,
  BrowserProfileWindowResult,
  BrowserProfileWindowStatus,
} from '../profile-windows/index.js';
import type {
  NativeChromeConnectionStatus,
  NativeChromeLaunchInput,
  NativeChromeLaunchResult,
} from '../native-chrome/index.js';

export type BrowserAutomationOverview = {
  enabled: boolean;
  skillName: string;
  activationStorePath: string;
  skill?: AgentSkillActivationView;
  browserSettings: BrowserProfileSettingsOverview;
  profileWindow: BrowserProfileWindowStatus;
  nativeChrome: NativeChromeConnectionStatus;
  profileRequirement: string;
  toolAvailability: string;
};

export type BrowserAutomationSetEnabledResult =
  | {
      ok: true;
      overview: BrowserAutomationOverview;
      activation?: AgentSkillActivationResult;
    }
  | {
      ok: false;
      reason: 'skill_not_found';
      overview: BrowserAutomationOverview;
    };

export type BrowserAutomationServiceOptions = {
  workspaceRoot: string;
  stateRoot: string;
};

export type BrowserAutomationSettingsUpdateInput = BrowserProfileSettingsUpdateInput;
export type BrowserAutomationSettingsUpdateResult = BrowserProfileSettingsUpdateResult;
export type BrowserAutomationProfileOpenInput = BrowserProfileWindowOpenInput;
export type BrowserAutomationProfileWindowResult = BrowserProfileWindowResult;
export type BrowserAutomationNativeChromeLaunchInput = NativeChromeLaunchInput;
export type BrowserAutomationNativeChromeLaunchResult = NativeChromeLaunchResult;
export type BrowserAutomationNativeChromeStatus = NativeChromeConnectionStatus;
