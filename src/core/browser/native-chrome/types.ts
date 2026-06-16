export type NativeChromeConnectionState = 'reachable' | 'unreachable';

export type NativeChromeConnectionStatus = {
  state: NativeChromeConnectionState;
  profileId: string;
  userDataDir: string;
  endpoint: string;
  port: number;
  defaultStartUrl: string;
  browser?: string;
  webSocketDebuggerUrl?: string;
  checkedAt: string;
};

export type NativeChromeLaunchInput = {
  profileId?: string;
  port?: number;
  url?: string;
  chromePath?: string;
};

export type NativeChromeLaunchResult =
  | {
      ok: true;
      status: NativeChromeConnectionStatus;
      startUrl: string;
      launchCommand?: string;
      reusedExisting: boolean;
    }
  | {
      ok: false;
      error: string;
      status: NativeChromeConnectionStatus;
      startUrl: string;
      launchCommand?: string;
      reusedExisting: boolean;
    };
