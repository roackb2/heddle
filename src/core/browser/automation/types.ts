import type {
  AgentSkillActivationResult,
  AgentSkillActivationView,
} from '@/core/skills/index.js';

export type BrowserAutomationOverview = {
  enabled: boolean;
  skillName: string;
  activationStorePath: string;
  skill?: AgentSkillActivationView;
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
