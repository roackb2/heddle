// ---------------------------------------------------------------------------
// Example: Browser Research Toolkit
//
// Usage:
//   yarn example:browser-research-toolkit
//   yarn example:browser-research-toolkit:headed
//   yarn example:browser-research-toolkit:headless
//
// This deterministic example validates the opt-in browser research tools without
// involving an LLM. It calls browser_open, browser_snapshot, browser_type,
// browser_click, browser_screenshot, and browser_close in the order an agent
// would use them for a search/navigation task.
// ---------------------------------------------------------------------------

import { join } from 'node:path';

import { createBrowserResearchToolkit, type BrowserResearchToolkitOptions } from '../src/advanced.js';
import type { ToolDefinition, ToolResult } from '../src/core/types.js';

type SnapshotOutput = {
  elements?: Array<{
    ref: string;
    role: string;
    name: string;
    href?: string;
    editable?: boolean;
    placeholder?: string;
    inputType?: string;
  }>;
};

const STATE_ROOT = join(process.cwd(), '.heddle', 'examples', 'browser-research-toolkit');
const START_URL = process.env.HEDDLE_BROWSER_START_URL ?? 'https://en.wikipedia.org/wiki/Browser_automation';
const ALLOWED_DOMAINS = ['wikipedia.org'];

async function main() {
  const headless = resolveHeadlessMode(process.argv.slice(2));
  const tools = createBrowserResearchToolkit({
    stateRoot: STATE_ROOT,
    allowedDomains: ALLOWED_DOMAINS,
    profileId: 'wikipedia-research-tools',
    headless,
    channel: resolveChannel(process.env.HEDDLE_BROWSER_CHANNEL),
    maxElementsPerSnapshot: 60,
  }).createTools({
    workspaceRoot: process.cwd(),
    stateRoot: STATE_ROOT,
    artifactRoot: join(STATE_ROOT, 'artifacts'),
    model: 'gpt-5.1-codex-mini',
    memoryDir: join(STATE_ROOT, 'memory'),
    memoryMode: 'none',
  });
  const toolMap = Object.fromEntries(tools.map((tool) => [tool.name, tool])) as Record<string, ToolDefinition>;

  try {
    console.log(`[browser-tools] mode=${headless ? 'headless' : 'headed'} stateRoot=${STATE_ROOT}`);

    const open = await runTool(toolMap.browser_open, { url: START_URL });
    console.log(`[browser_open] ${formatResult(open)}`);
    if (!open.ok) {
      return;
    }

    const snapshot = await runTool(toolMap.browser_snapshot, {});
    let elements = (snapshot.output as SnapshotOutput | undefined)?.elements ?? [];
    console.log(`[browser_snapshot] ${elements.length} interactive elements`);
    for (const element of elements.slice(0, 8)) {
      console.log(`  ${element.ref} ${element.role} ${element.name}`);
    }

    const searchField = elements.find((element) => element.editable && (
      element.role === 'searchbox'
      || element.inputType === 'search'
      || element.placeholder?.toLowerCase().includes('search')
      || element.name.toLowerCase().includes('search')
    ));
    if (searchField) {
      const typed = await runTool(toolMap.browser_type, {
        ref: searchField.ref,
        text: 'browser automation history',
        submit: true,
      });
      console.log(`[browser_type] ${searchField.name}: ${formatResult(typed)}`);
      const afterTypeSnapshot = await runTool(toolMap.browser_snapshot, {});
      elements = (afterTypeSnapshot.output as SnapshotOutput | undefined)?.elements ?? [];
      console.log(`[browser_snapshot] after type ${elements.length} interactive elements`);
    } else {
      console.log('[browser_type] skipped: no editable search field found');
    }

    const safeLink = elements.find((element) => (
      element.role === 'link'
      && element.href?.includes('wikipedia.org')
      && !element.href.includes('#')
    ));
    if (safeLink) {
      const click = await runTool(toolMap.browser_click, { ref: safeLink.ref });
      console.log(`[browser_click] ${safeLink.name}: ${formatResult(click)}`);
    } else {
      console.log('[browser_click] skipped: no safe same-domain link found');
    }

    const screenshot = await runTool(toolMap.browser_screenshot, { name: 'toolkit-final-page' });
    console.log(`[browser_screenshot] ${formatResult(screenshot)}`);
  } finally {
    const close = await runTool(toolMap.browser_close, {});
    console.log(`[browser_close] ${formatResult(close)}`);
  }
}

async function runTool(tool: ToolDefinition | undefined, input: unknown): Promise<ToolResult> {
  if (!tool) {
    return { ok: false, error: 'Tool was not registered.' };
  }

  return await tool.execute(input);
}

function formatResult(result: ToolResult): string {
  if (!result.ok) {
    return `failed ${result.error}`;
  }

  return JSON.stringify(result.output);
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

function resolveChannel(value: string | undefined): BrowserResearchToolkitOptions['channel'] {
  const channels: Array<BrowserResearchToolkitOptions['channel']> = ['chrome', 'chromium', 'msedge'];
  return channels.find((channel) => channel === value);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
