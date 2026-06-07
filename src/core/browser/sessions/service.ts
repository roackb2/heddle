import { randomUUID } from 'node:crypto';

import dayjs from 'dayjs';

import { BrowserEvidenceService } from '../evidence/index.js';
import { BrowserPolicyService } from '../policy/index.js';
import { BrowserSnapshotService } from '../snapshots/index.js';
import type {
  BrowserActionEvidenceEvent,
  BrowserActionResult,
  BrowserClickInput,
  BrowserDriver,
  BrowserDriverFactory,
  BrowserOpenInput,
  BrowserScreenshotInput,
  BrowserSessionConfig,
  BrowserSnapshot,
} from '../types.js';

/**
 * Owns one browser run: driver lifecycle, policy checks, snapshots, and evidence.
 */
export class BrowserSessionService {
  private driver?: BrowserDriver;
  private latestSnapshot?: BrowserSnapshot;
  private readonly evidence: BrowserEvidenceService;
  private readonly policy: BrowserPolicyService;

  constructor(
    private readonly config: BrowserSessionConfig,
    private readonly driverFactory: BrowserDriverFactory,
  ) {
    this.evidence = new BrowserEvidenceService(config.evidenceDir);
    this.policy = new BrowserPolicyService(config.policy);
  }

  async open(input: BrowserOpenInput): Promise<BrowserActionResult<{ finalUrl: string }>> {
    const actionId = this.actionId('open');
    const timestamp = this.now();
    const decision = this.policy.evaluateNavigation(input.url);
    if (decision.status !== 'allowed') {
      await this.record({
        id: actionId,
        timestamp,
        action: 'open',
        status: decision.status,
        reason: decision.reason,
        detail: { url: input.url },
      });
      return {
        status: decision.status,
        actionId,
        timestamp,
        reason: decision.reason,
      };
    }

    const driver = await this.getDriver();
    const finalUrl = await driver.open(input.url);
    const finalDecision = this.policy.evaluateNavigation(finalUrl);
    await this.record({
      id: actionId,
      timestamp,
      action: 'open',
      status: finalDecision.status === 'allowed' ? 'completed' : finalDecision.status,
      url: finalUrl,
      reason: finalDecision.reason,
      detail: { requestedUrl: input.url, finalUrl },
    });

    return {
      status: finalDecision.status,
      actionId,
      timestamp,
      url: finalUrl,
      reason: finalDecision.reason,
      data: { finalUrl },
    };
  }

  async snapshot(): Promise<BrowserActionResult<BrowserSnapshot>> {
    const actionId = this.actionId('snapshot');
    const timestamp = this.now();
    const driver = await this.getDriver();
    const snapshot = BrowserSnapshotService.create(
      await driver.snapshot({ maxElements: this.policy.maxElementsPerSnapshot() }),
    );
    this.latestSnapshot = snapshot;
    const snapshotPath = await this.evidence.recordSnapshot(snapshot);
    await this.record({
      id: actionId,
      timestamp,
      action: 'snapshot',
      status: 'completed',
      url: snapshot.url,
      detail: { snapshotId: snapshot.id, snapshotPath, elementCount: snapshot.elements.length },
    });

    return {
      status: 'allowed',
      actionId,
      timestamp,
      url: snapshot.url,
      data: snapshot,
    };
  }

  async click(input: BrowserClickInput): Promise<BrowserActionResult<{ finalUrl: string }>> {
    const actionId = this.actionId('click');
    const timestamp = this.now();
    const element = this.latestSnapshot?.elements.find((candidate) => candidate.ref === input.ref);
    if (!element) {
      const reason = `Unknown browser snapshot ref: ${input.ref}`;
      await this.record({
        id: actionId,
        timestamp,
        action: 'click',
        status: 'blocked',
        reason,
        detail: { ref: input.ref },
      });
      return {
        status: 'blocked',
        actionId,
        timestamp,
        reason,
      };
    }

    const decision = this.policy.evaluateClick(element);
    if (decision.status !== 'allowed') {
      return await this.completePolicyDeniedClick({
        actionId,
        timestamp,
        ref: input.ref,
        element,
        decision,
        url: this.currentUrl(),
      });
    }

    let blockedNavigation: { url: string; decision: ReturnType<BrowserPolicyService['evaluateNavigation']> } | undefined;
    let finalUrl: string;
    try {
      finalUrl = await (await this.getDriver()).click(input.ref, {
        canNavigateTo: (url) => {
          const navigationDecision = this.policy.evaluateNavigation(url);
          if (navigationDecision.status === 'allowed') {
            return true;
          }

          blockedNavigation = { url, decision: navigationDecision };
          return false;
        },
      });
    } catch (error) {
      this.latestSnapshot = undefined;
      if (blockedNavigation) {
        return await this.completePolicyDeniedClick({
          actionId,
          timestamp,
          ref: input.ref,
          element,
          decision: blockedNavigation.decision,
          url: blockedNavigation.url,
        });
      }

      throw error;
    }
    this.latestSnapshot = undefined;

    if (blockedNavigation) {
      return await this.completePolicyDeniedClick({
        actionId,
        timestamp,
        ref: input.ref,
        element,
        decision: blockedNavigation.decision,
        url: blockedNavigation.url,
      });
    }

    const finalDecision = this.policy.evaluateNavigation(finalUrl);
    await this.record({
      id: actionId,
      timestamp,
      action: 'click',
      status: finalDecision.status === 'allowed' ? 'completed' : finalDecision.status,
      url: finalUrl,
      reason: finalDecision.reason,
      detail: { ref: input.ref, target: this.evidenceTarget(element), finalUrl },
    });

    return {
      status: finalDecision.status,
      actionId,
      timestamp,
      url: finalUrl,
      reason: finalDecision.reason,
      data: { finalUrl },
    };
  }

  private async completePolicyDeniedClick(args: {
    actionId: string;
    timestamp: string;
    ref: string;
    element: BrowserSnapshot['elements'][number];
    decision: ReturnType<BrowserPolicyService['evaluateNavigation']>;
    url?: string;
  }): Promise<BrowserActionResult<{ finalUrl: string }>> {
    await this.record({
      id: args.actionId,
      timestamp: args.timestamp,
      action: 'click',
      status: args.decision.status,
      reason: args.decision.reason,
      url: args.url,
      detail: { ref: args.ref, target: this.evidenceTarget(args.element) },
    });
    return {
      status: args.decision.status,
      actionId: args.actionId,
      timestamp: args.timestamp,
      url: args.url,
      reason: args.decision.reason,
    };
  }

  async screenshot(input: BrowserScreenshotInput = {}): Promise<BrowserActionResult<{ path: string }>> {
    const actionId = this.actionId('screenshot');
    const timestamp = this.now();
    const path = this.evidence.screenshotPath(actionId, input.name);
    await this.evidence.initialize();
    await (await this.getDriver()).screenshot(path);
    await this.record({
      id: actionId,
      timestamp,
      action: 'screenshot',
      status: 'completed',
      url: this.currentUrl(),
      detail: { path },
    });

    return {
      status: 'allowed',
      actionId,
      timestamp,
      url: this.currentUrl(),
      data: { path },
    };
  }

  async close(): Promise<BrowserActionResult> {
    const actionId = this.actionId('close');
    const timestamp = this.now();
    await this.driver?.close();
    this.driver = undefined;
    await this.record({
      id: actionId,
      timestamp,
      action: 'close',
      status: 'completed',
    });

    return {
      status: 'allowed',
      actionId,
      timestamp,
    };
  }

  private async getDriver(): Promise<BrowserDriver> {
    if (!this.driver) {
      this.driver = await this.driverFactory.launch({ profile: this.config.profile });
    }

    return this.driver;
  }

  private currentUrl(): string | undefined {
    return this.driver?.currentUrl();
  }

  private async record(event: BrowserActionEvidenceEvent): Promise<void> {
    await this.evidence.recordEvent(event);
  }

  private actionId(action: BrowserActionEvidenceEvent['action']): string {
    return `browser_${action}_${randomUUID()}`;
  }

  private evidenceTarget(element: BrowserSnapshot['elements'][number]): Record<string, string | undefined> {
    return {
      ref: element.ref,
      role: element.role,
      name: element.name,
      text: element.text,
      href: element.href,
      tagName: element.tagName,
    };
  }

  private now(): string {
    return dayjs().toISOString();
  }
}
