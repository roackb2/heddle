# Browser

Browser owns Heddle's experimental browser automation runtime boundary.

This domain is intentionally isolated while the feature is being validated. It
should be possible to remove `src/core/browser/` and its example/tests without
unwinding chat, server, or web-v2 behavior.

## Owns

- Heddle-owned browser profile resolution and in-process profile locks.
- Browser session lifecycle over a driver adapter.
- Browser navigation and action policy decisions.
- Accessibility-oriented page snapshots with snapshot-scoped element refs.
- Browser run evidence files such as events, snapshots, and screenshots.
- The Playwright driver adapter used by the validation spike.

## Does Not Own

- Conversation engine tool registration.
- Control-plane APIs or web-v2 presentation.
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
- Evidence is domain-owned in this spike under a caller-provided run directory.
  Projection into Heddle trace or conversation activities should be a later,
  deliberate integration.

## Validation Spike

The first supported mode is read-oriented research:

- open allowlisted public pages;
- capture a snapshot;
- click safe snapshot refs;
- capture screenshots;
- write evidence;
- block or require approval for unsafe actions.

Do not add default agent tools, web-v2 UI, or ecommerce-domain policy packs until
this foundation is proven useful.

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
- No default agent tool registration.
- No conversation-engine, server, or web-v2 integration.
- No ecommerce policy packs for Shopee, Airspace, or other shopping sites yet.
