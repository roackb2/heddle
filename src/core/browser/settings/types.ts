import type { BrowserBackendSelection, BrowserProfileConfig } from '../types.js';

export type BrowserDisplayMode = 'headless' | 'headed';
export type BrowserChannelSelection = NonNullable<BrowserProfileConfig['channel']>;

export type BrowserProfileSettings = {
  profileId: string;
  backend?: BrowserBackendSelection;
  channel?: BrowserChannelSelection;
  headless: boolean;
  cdpEndpoint?: string;
  updatedAt?: string;
};

export type BrowserProfileSettingsUpdateInput = {
  profileId?: string;
  backend?: BrowserBackendSelection;
  channel?: BrowserChannelSelection;
  headless?: boolean;
  cdpEndpoint?: string;
};

export type BrowserProfileView = {
  profileId: string;
  userDataDir: string;
  selected: boolean;
};

export type BrowserProfileSettingsOverview = BrowserProfileSettings & {
  backendSelection: BrowserBackendSelection;
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
