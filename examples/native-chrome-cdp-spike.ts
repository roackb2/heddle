// ---------------------------------------------------------------------------
// Example: Native Chrome CDP Attach Spike
//
// Usage:
//   yarn spike:native-chrome-profile --profile personal --port 9223 --url https://en.wikipedia.org/wiki/Main_Page
//   HEDDLE_NATIVE_CHROME_CDP_ENDPOINT=http://127.0.0.1:9223 yarn example:native-chrome-cdp-spike
//
// This validates the first native Chrome backend slice without involving an
// LLM. It attaches to user-launched Chrome, opens a URL, captures a snapshot,
// types into a search field when one is visible, captures a screenshot, then
// detaches.
// ---------------------------------------------------------------------------

import { join } from 'node:path';

import { createBrowserResearchToolkit } from '../src/advanced.js';
import type { ToolDefinition, ToolResult } from '../src/core/types.js';

type SnapshotOutput = {
  title?: string;
  url?: string;
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

const STATE_ROOT = join(process.cwd(), '.heddle', 'examples', 'native-chrome-cdp-spike');
const START_URL = process.env.HEDDLE_BROWSER_START_URL ?? 'https://en.wikipedia.org/wiki/Main_Page';
const CDP_ENDPOINT = process.env.HEDDLE_NATIVE_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

async function main() {
  const tools = createBrowserResearchToolkit({
    stateRoot: STATE_ROOT,
    allowedDomains: [],
    profileId: process.env.HEDDLE_BROWSER_PROFILE_ID ?? 'browser-automation',
    backend: 'native-chrome-cdp',
    cdpEndpoint: CDP_ENDPOINT,
    maxElementsPerSnapshot: 80,
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
    console.log(`[native-cdp] endpoint=${CDP_ENDPOINT}`);

    const open = await runTool(toolMap.browser_open, { url: START_URL });
    console.log(`[browser_open] ${formatResult(open)}`);
    if (!open.ok) {
      return;
    }

    const snapshot = await runTool(toolMap.browser_snapshot, {});
    let snapshotOutput = snapshot.output as SnapshotOutput | undefined;
    console.log(`[browser_snapshot] title=${snapshotOutput?.title ?? ''} url=${snapshotOutput?.url ?? ''}`);
    for (const element of (snapshotOutput?.elements ?? []).slice(0, 10)) {
      console.log(`  ${element.ref} ${element.role} ${element.name}${element.href ? ` -> ${element.href}` : ''}`);
    }

    const searchField = (snapshotOutput?.elements ?? []).find((element) => element.editable && (
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
      snapshotOutput = afterTypeSnapshot.output as SnapshotOutput | undefined;
      console.log(`[browser_snapshot] after type title=${snapshotOutput?.title ?? ''} url=${snapshotOutput?.url ?? ''}`);
    } else {
      console.log('[browser_type] skipped: no editable search field found');
    }

    const screenshot = await runTool(toolMap.browser_screenshot, { name: 'native-chrome-cdp-page' });
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
