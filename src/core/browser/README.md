# Browser

Browser owns Heddle's experimental browser automation runtime boundary.

This domain is intentionally isolated while the feature is being validated. It
should be possible to remove `src/core/browser/` and its example/tests without
unwinding chat, server, or web-v2 behavior.

## Owns

- Heddle-owned browser profile resolution and in-process profile locks.
- Browser session lifecycle over a driver adapter.
- Browser profile settings for selected Heddle-owned profile id and headless or
  headed execution.
- User-managed profile windows for manual login/session preparation.
- Browser navigation and action policy decisions.
- Accessibility-oriented page snapshots with snapshot-scoped element refs.
- Browser run evidence files such as events, snapshots, and screenshots.
- The Playwright driver adapter used by the validation spike.

## Does Not Own

- Conversation engine tool registration.
- Control-plane API transport or web-v2 presentation.
- TUI rendering.
- Generic Heddle trace projection.
- Transaction, checkout, payment, booking, messaging, or account-change flows.

## Boundary Notes

- Hosts should call `BrowserSessionService` instead of importing Playwright
  directly.
- The browser domain must not leak Playwright `Page`, `Locator`, or selector
  objects through public browser-domain types.
- Policy must run before browser actions. Prompt instructions are not a safety
  boundary.
- Element refs are only valid for the snapshot that produced them.
- Snapshot extraction reports browser and DOM facts only. It must not infer
  site-specific route conventions, locale prefixes, storefront paths, account
  sections, or workflow meanings from one observed website. If a page rewrites
  or localizes navigation, the agent must use `browser_click` or `browser_open`
  and verify the final URL from the next tool result or snapshot.
- Evidence is domain-owned in this spike under a caller-provided run directory.
  Projection into Heddle trace or conversation activities should be a later,
  deliberate integration.

## Service Map

- `settings/`: persists the selected profile, backend, display mode, channel,
  and native CDP endpoint. It owns validation and user-facing settings overview
  data.
- `native-chrome/`: launches locally installed Chrome with a Heddle-owned
  profile, verifies the local CDP endpoint, and records the profile/endpoint
  for future native CDP attach.
- `profile-windows/`: opens and tracks manual Playwright-managed profile
  windows for login/session preparation. It does not launch native Chrome CDP
  windows.
- `automation/`: owns the Browser Automation capability switch and built-in
  skill activation contract.
- `drivers/`: resolves a backend selection to a concrete driver factory.
- `playwright/`: owns the Playwright-managed browser driver.
- `chrome-cdp/`: owns the native Chrome CDP attach driver.
- `sessions/`: owns browser session lifecycle and policy-gated browser
  operations over a driver.

## Validation Spike

The first supported mode is read-oriented research:

- open allowlisted public pages;
- capture a snapshot;
- click safe snapshot refs;
- capture screenshots;
- write evidence;
- block or require approval for unsafe actions.

Default agent tools are now opt-in through Browser Automation. Do not add
ecommerce-domain policy packs until this foundation is proven useful for
ordinary browser inspection and read-oriented workflows.

## Example

Run the deterministic validation example from the browser automation worktree:

```bash
yarn example:browser-runtime-spike
yarn example:browser-runtime-spike:headless
yarn example:browser-runtime-spike:headed
```

The default mode is headless. `:headed` opens a visible browser window so the
operator can inspect the run manually.

The example stores its Heddle-owned profile under:

```text
.heddle/examples/browser-runtime-spike/browser-profiles/wikipedia-research
```

## Native Chrome Profile Launcher

Native Chrome mode opens the locally installed Google Chrome binary with a
Heddle-specific, non-default profile directory and a local CDP port. It is for
sites that reject Playwright-launched browsers or require the login behavior of
ordinary Chrome.

Users can launch the selected profile from Settings -> Browser Automation or
from terminal chat:

```text
/browser backend native-chrome
/browser launch-native
/browser check-native
```

The default validation URL is Wikipedia. It has real rendered text and links but
does not require login, shopping, or account actions.

```bash
yarn spike:native-chrome-profile
yarn spike:native-chrome-profile --profile personal --port 9223 --url https://en.wikipedia.org/wiki/Main_Page
```

The profile is stored under:

```text
.heddle/native-chrome-profiles/<profile-id>
```

The script avoids Playwright and does not pass automation-specific launch flags.
It only starts Chrome with `--remote-debugging-port=<port>` and
`--user-data-dir=<profile-dir>`. Keep the port non-zero; `0` has different
browser-detection semantics and is not the user-authorized CDP shape this spike
is validating.

The launcher itself only starts Chrome and checks CDP reachability. Browser
tools use the native Chrome CDP backend, which connects to the configured
`http://127.0.0.1:<port>` endpoint:

```bash
HEDDLE_NATIVE_CHROME_CDP_ENDPOINT=http://127.0.0.1:9223 \
HEDDLE_BROWSER_START_URL=https://en.wikipedia.org/wiki/Main_Page \
yarn example:native-chrome-cdp-spike
```

This validates `browser_open`, `browser_snapshot`, `browser_screenshot`, and
`browser_close` against the user-launched Chrome session. `browser_close`
detaches from Chrome; it should not close the user's browser process.

These examples intentionally use neutral URLs. The backend must stay
site-agnostic: users choose the site, profile, port, and policy at runtime, and
browser code must not encode assumptions from one validation website.

Native CDP `browser_click` is intentionally disabled until the backend can
preserve the same navigation-policy guarantees as the Playwright driver. Do not
add click/type/form actions to this backend without retaining Heddle-owned
domain policy and approval semantics.

Run evidence is written under:

```text
.heddle/examples/browser-runtime-spike/browser-runs/<run-id>/
  events.jsonl
  screenshots/
  snapshots/
```

## Current Non-Goals

- No `type()` action in the first spike.
- No form submission, cart, checkout, payment, booking, message-send, account
  mutation, upload, or download flows.
- No live browser preview embedded in the control plane yet.
- No site-specific shopping, SaaS, social, or account-management policy packs
  yet.
