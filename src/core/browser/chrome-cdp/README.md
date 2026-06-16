# Native Chrome CDP Browser Driver

`chrome-cdp/` owns the experimental browser driver that attaches to a
user-launched native Google Chrome instance through the Chrome DevTools Protocol
endpoint.

This backend exists for sites that block Playwright-launched Chromium but allow
normal user-launched Chrome with a dedicated Heddle profile.

## Owns

- Connecting to a local CDP endpoint that the user explicitly launched.
- Selecting the first available browser context and page for the attached
  native Chrome session.
- Implementing read-oriented browser driver operations:
  - `open`
  - `snapshot`
  - `screenshot`
  - `currentUrl`
  - `close` as CDP detach
- Producing the same browser-domain snapshot shape as the Playwright backend.
- Keeping native Chrome attach behavior generic and site-agnostic.

## Does Not Own

- Launching Chrome. Use `scripts/open-native-chrome-profile.mjs` for the spike
  launcher.
- Choosing whether a workspace should use this backend. That belongs to browser
  profile settings.
- Tool registration or conversation runtime orchestration.
- Browser action policy, approval, checkout/payment/account mutation policy, or
  allowlist configuration.
- User-facing settings UI or slash command parsing.
- Site-specific route repair, locale-prefix inference, account-page shortcuts,
  or shopping-site assumptions.

## Safety Boundary

Native CDP currently supports read-oriented use only. `click` intentionally
throws until this backend preserves the same navigation-policy guarantees as the
Playwright driver.

Do not add click, type, upload, download, form submission, cart, checkout,
payment, booking, messaging, or account-change actions here unless the browser
domain has a matching policy and approval boundary first.

## Maintenance Notes

- The backend must attach to the configured CDP endpoint; it must not silently
  launch its own browser.
- `close()` should detach Heddle from CDP. It should not be used as a user
  intent to quit Chrome.
- Snapshot extraction should report observed browser facts only. If a website
  rewrites links, localizes paths, or hides route structure behind JavaScript,
  the agent must verify through subsequent browser tool results instead of
  relying on hard-coded URL conventions.
- Keep public driver return types aligned with `src/core/browser/types.ts`; do
  not leak Playwright `Page`, `Locator`, or CDP protocol objects across the
  browser-domain boundary.

