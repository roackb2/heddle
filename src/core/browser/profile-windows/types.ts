import type { BrowserDriverFactory } from '../types.js';

export type BrowserProfileWindowStatus = {
  profileId: string;
  userDataDir: string;
  open: boolean;
  currentUrl?: string;
  openedAt?: string;
};

export type BrowserProfileWindowOpenInput = {
  url?: string;
  driverFactory?: BrowserDriverFactory;
};

export type BrowserProfileWindowResult =
  | {
      ok: true;
      status: BrowserProfileWindowStatus;
    }
  | {
      ok: false;
      error: string;
      status: BrowserProfileWindowStatus;
    };
