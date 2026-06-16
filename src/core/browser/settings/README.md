# Browser Profile Settings

This folder owns persisted browser execution settings for Browser Automation.

The settings file is workspace-local:

```text
.heddle/browser/settings.json
```

It stores:

- `profileId`: the Heddle-owned profile directory future browser runs should
  use under `.heddle/browser-profiles/<profileId>`.
- `backend`: `playwright-managed` or the experimental `native-chrome-cdp`
  attach backend.
- `headless`: whether future Playwright sessions run without a visible window.
- `channel`: browser channel selection for future browser runs and manual
  profile windows. Supported values are `chromium`, `chrome`, and `msedge`.
- `cdpEndpoint`: local CDP origin for the experimental native Chrome backend,
  for example `http://127.0.0.1:9222`.

## User Mental Model

By default, users do not point Heddle at their real Chrome profile. Heddle
creates and uses its own persistent browser profiles inside the workspace state
directory.

To prepare a logged-in profile, users switch Browser Automation to headed mode,
run a browser task that opens the target site, log in manually in the visible
Playwright window, close the run, then switch back to headless mode if they want
future agent runs to reuse the saved session quietly.

For the experimental native Chrome CDP backend, users explicitly launch native
Chrome with a Heddle-specific non-default profile and a local remote-debugging
port. Heddle attaches to that local endpoint instead of launching Chrome. This
backend must be treated as user-owned browser state: closing a browser session
detaches Heddle and must not close the user's Chrome process.

## Boundaries

Owned here:

- Reading and writing browser profile/display settings.
- Validating profile ids so they cannot escape Heddle's profile directory.
- Reporting discovered Heddle-owned profile directories for settings UIs.
- Producing toolkit options for default Browser Automation tool registration.

Not owned here:

- Browser profile locks and directory creation during a run. That belongs to
  `BrowserProfileService`.
- Browser policy, allowlists, and forbidden actions.
- Browser run evidence, screenshots, snapshots, and session activity rendering.
- Credential entry, account mutation, checkout, payment, or form automation.

Invalid or corrupted settings fall back to defaults so Browser Automation can
recover through Settings or `/browser profile <id>` instead of breaking every
future run.
