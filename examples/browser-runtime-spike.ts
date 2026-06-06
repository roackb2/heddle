// ---------------------------------------------------------------------------
// Example: Browser Runtime Spike
//
// Usage:
//   yarn example:browser-runtime-spike
//   yarn example:browser-runtime-spike:headed
//   yarn example:browser-runtime-spike:headless
//
// Optional:
//   yarn example:browser-runtime-spike -- --headed
//   yarn example:browser-runtime-spike -- --headless
//   HEDDLE_BROWSER_CHANNEL=chrome yarn example:browser-runtime-spike
//
// This deterministic example validates the experimental browser domain without
// involving an LLM. It opens a Heddle-owned browser profile, visits an
// allowlisted public page, captures a snapshot, clicks a safe same-domain link,
// captures a screenshot, and writes run evidence under .heddle/examples/.
// ---------------------------------------------------------------------------

import { join } from 'node:path';

import {
  BrowserProfileService,
  BrowserSessionService,
  BrowserPolicyService,
  PlaywrightBrowserDriverFactory,
  type BrowserProfileConfig,
  type BrowserSnapshotElement,
} from '../src/core/browser/index.js';

const STATE_ROOT = join(process.cwd(), '.heddle', 'examples', 'browser-runtime-spike');
const EVIDENCE_DIR = join(STATE_ROOT, 'browser-runs', `run-${Date.now()}`);
const START_URL = process.env.HEDDLE_BROWSER_START_URL ?? 'https://en.wikipedia.org/wiki/Browser_automation';
const ALLOWED_DOMAINS = ['wikipedia.org'];

async function main() {
  const headless = resolveHeadlessMode(process.argv.slice(2));
  const lease = await BrowserProfileService.acquire({
    stateRoot: STATE_ROOT,
    profileId: 'wikipedia-research',
    channel: resolveChannel(process.env.HEDDLE_BROWSER_CHANNEL),
    headless,
  });

  const session = new BrowserSessionService({
    profile: lease.profile,
    policy: {
      allowedDomains: ALLOWED_DOMAINS,
      maxElementsPerSnapshot: 60,
    },
    evidenceDir: EVIDENCE_DIR,
  }, new PlaywrightBrowserDriverFactory());

  try {
    console.log(`[browser] mode=${headless ? 'headless' : 'headed'} profile=${lease.profile.userDataDir}`);
    const open = await session.open({ url: START_URL });
    console.log(`[open] ${open.status} ${open.data?.finalUrl ?? open.reason ?? START_URL}`);
    if (open.status !== 'allowed') {
      return;
    }

    const snapshot = await session.snapshot();
    const elements = snapshot.data?.elements ?? [];
    console.log(`[snapshot] ${elements.length} interactive elements`);
    for (const element of elements.slice(0, 8)) {
      console.log(`  ${element.ref} ${element.role} ${element.name}`);
    }

    const safeLink = findSafeSameDomainLink(elements);
    if (safeLink) {
      const click = await session.click({ ref: safeLink.ref });
      console.log(`[click] ${safeLink.name}: ${click.status} ${click.data?.finalUrl ?? click.reason ?? ''}`);
    } else {
      console.log('[click] skipped: no safe same-domain link found');
    }

    const screenshot = await session.screenshot({ name: 'final-page' });
    console.log(`[screenshot] ${screenshot.data?.path}`);
    console.log(`[evidence] ${EVIDENCE_DIR}`);
  } finally {
    await session.close();
    lease.release();
  }
}

function findSafeSameDomainLink(elements: BrowserSnapshotElement[]): BrowserSnapshotElement | undefined {
  const policy = new BrowserPolicyService({ allowedDomains: ALLOWED_DOMAINS });
  return elements.find((element) => (
    element.role === 'link'
    && Boolean(element.href)
    && policy.evaluateClick(element).status === 'allowed'
    && !element.href?.includes('#')
  ));
}

function resolveChannel(value: string | undefined): BrowserProfileConfig['channel'] | undefined {
  const channels: BrowserProfileConfig['channel'][] = ['chrome', 'chromium', 'msedge'];
  return channels.find((channel) => channel === value);
}

function resolveHeadlessMode(args: string[]): boolean {
  if (args.includes('--headed')) {
    return false;
  }

  if (args.includes('--headless')) {
    return true;
  }

  return process.env.HEDDLE_BROWSER_HEADLESS !== 'false';
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
