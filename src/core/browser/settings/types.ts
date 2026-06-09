import type { BrowserProfileConfig } from '../types.js';

export type BrowserDisplayMode = 'headless' | 'headed';
export type BrowserChannelSelection = NonNullable<BrowserProfileConfig['channel']>;

export type BrowserProfileSettings = {
  profileId: string;
  channel?: BrowserChannelSelection;
  headless: boolean;
  updatedAt?: string;
};

export type BrowserProfileSettingsUpdateInput = {
  profileId?: string;
  channel?: BrowserChannelSelection;
  headless?: boolean;
};

export type BrowserProfileView = {
  profileId: string;
  userDataDir: string;
  selected: boolean;
};

export type BrowserProfileSettingsOverview = BrowserProfileSettings & {
  channelSelection: BrowserChannelSelection;
  displayMode: BrowserDisplayMode;
  settingsStorePath: string;
  userDataDir: string;
  profiles: BrowserProfileView[];
  profileInstruction: string;
  evidenceNote: string;
};

export type BrowserProfileSettingsUpdateResult =
  | {
      ok: true;
      settings: BrowserProfileSettingsOverview;
    }
  | {
      ok: false;
      error: string;
      settings: BrowserProfileSettingsOverview;
    };
