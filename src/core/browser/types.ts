export type BrowserRunMode = 'research' | 'shopping-assist' | 'transaction';

export type BrowserActionStatus = 'allowed' | 'blocked' | 'approvalRequired';

export type BrowserBackendSelection = 'playwright-managed' | 'native-chrome-cdp';

export interface BrowserPolicyConfig {
  allowedDomains: string[];
  forbiddenActionText?: string[];
  requireApprovalForOffDomainNavigation?: boolean;
  maxElementsPerSnapshot?: number;
}

export interface BrowserPolicyDecision {
  status: BrowserActionStatus;
  reason?: string;
  risk?: 'low' | 'medium' | 'high';
}

export interface BrowserProfileConfig {
  profileId: string;
  userDataDir: string;
  backend?: BrowserBackendSelection;
  channel?: 'chrome' | 'chromium' | 'msedge';
  headless?: boolean;
  cdpEndpoint?: string;
}

export interface BrowserSessionConfig {
  runId?: string;
  mode?: BrowserRunMode;
  profile: BrowserProfileConfig;
  policy: BrowserPolicyConfig;
  evidenceDir: string;
}

export interface BrowserOpenInput {
  url: string;
}

export interface BrowserClickInput {
  ref: string;
}

export interface BrowserScreenshotInput {
  name?: string;
}

export interface BrowserActionResult<T = unknown> {
  status: BrowserActionStatus;
  actionId: string;
  timestamp: string;
  url?: string;
  reason?: string;
  data?: T;
}

export interface BrowserSnapshot {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  ariaSnapshot: string;
  elements: BrowserSnapshotElement[];
}

export interface BrowserSnapshotElement {
  ref: string;
  role: string;
  name: string;
  text?: string;
  href?: string;
  rawHref?: string;
  tagName?: string;
}

export interface BrowserActionEvidenceEvent {
  id: string;
  timestamp: string;
  action: 'open' | 'snapshot' | 'click' | 'screenshot' | 'close';
  status: BrowserActionStatus | 'completed';
  url?: string;
  reason?: string;
  detail?: Record<string, unknown>;
}

export interface BrowserDriverLaunchOptions {
  profile: BrowserProfileConfig;
}

export interface BrowserDriverSnapshotOptions {
  maxElements: number;
}

export interface BrowserDriverSnapshotResult {
  url: string;
  title: string;
  ariaSnapshot: string;
  elements: BrowserSnapshotElement[];
}

export interface BrowserDriverClickOptions {
  canNavigateTo?: (url: string) => boolean;
}

export interface BrowserDriver {
  open(url: string): Promise<string>;
  snapshot(options: BrowserDriverSnapshotOptions): Promise<BrowserDriverSnapshotResult>;
  click(ref: string, options?: BrowserDriverClickOptions): Promise<string>;
  screenshot(path: string): Promise<void>;
  close(): Promise<void>;
  currentUrl(): string | undefined;
}

export interface BrowserDriverFactory {
  launch(options: BrowserDriverLaunchOptions): Promise<BrowserDriver>;
}
