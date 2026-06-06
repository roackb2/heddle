# Browser Research Toolkit

This toolkit exposes the experimental browser domain as opt-in agent tools.

It is not part of `RuntimeToolService.createDefaultAgentTools(...)`. Hosts must
include `createBrowserResearchToolkit(...)` deliberately when they want a
research-only browser run.

The package root may export this toolkit without forcing browser automation onto
all programmatic users. The default driver loads the optional `playwright` peer
only when a browser session is launched. Hosts that do not install Playwright
can still import Heddle normally, and browser hosts may either install
`playwright` or pass a custom `driverFactory`.

## Owns

- Tool input validation for browser research actions.
- A single lazy browser session shared across the toolkit tools.
- Human-readable tool outputs for browser open, snapshot, click, screenshot,
  and close actions.

## Does Not Own

- Browser execution, profile locks, policy, snapshots, or evidence persistence.
  Those stay in `src/core/browser`.
- Approval UI or pending approval coordination.
- Default runtime tool composition.
- Form typing, transactions, checkout, payment, booking, messaging, uploads, or
  downloads.

## Flow

1. `browser_open` must run first.
2. `browser_snapshot` returns snapshot-scoped refs.
3. `browser_click` accepts one current snapshot ref and lets browser policy
   decide whether the click is allowed.
4. `browser_screenshot` records a screenshot artifact.
5. `browser_close` closes the driver and releases the profile lease.

If browser policy blocks or requires approval for an action, the tool returns a
failed tool result instead of executing the browser driver action.

## Example

Run the deterministic toolkit example from the browser automation worktree:

```bash
yarn example:browser-research-toolkit
yarn example:browser-research-toolkit:headless
yarn example:browser-research-toolkit:headed
```

The example calls the tools directly in this order:

```text
browser_open -> browser_snapshot -> browser_click -> browser_screenshot -> browser_close
```

This validates the tool boundary an agent will eventually use, but it still does
not involve an LLM.

Run the live agent smoke when you want to validate whether a model can operate
the toolkit without any default coding tools:

```bash
yarn example:browser-agent-smoke:headless
yarn example:browser-agent-smoke:headed
```

The smoke uses `gpt-5.4` by default because it works with OpenAI account
sign-in. Set `HEDDLE_EXAMPLE_MODEL` to try another model, or set
`HEDDLE_BROWSER_AGENT_CREDENTIAL=api-key` to force platform API-key mode.
