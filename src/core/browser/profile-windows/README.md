# Browser Profile Windows

This folder owns user-managed browser windows for preparing Heddle-owned
browser profiles.

These windows are not agent browser runs. They exist so a user can open the
selected Browser Automation profile, log in manually, adjust cookies or session
state, and then close the window before asking an agent to reuse that profile.

## Behavior

- The selected profile comes from `BrowserProfileSettingsService`.
- The window always opens headed, regardless of the saved headless/headed
  default for future agent runs.
- The service uses `BrowserProfileService.acquire(...)`, so an open manual
  profile window holds the same in-process profile lock as an agent browser run.
- Optional start URLs must be `http` or `https`.

## Boundaries

Owned here:

- Opening and closing manual profile windows.
- Holding and releasing the profile lock while the window is open.
- Reporting manual window status for Settings and `/browser`.

Not owned here:

- Agent browser tools such as `browser_open` or `browser_snapshot`.
- Browser evidence, screenshots, or trace rendering.
- Credential entry automation. The user types credentials manually in the
  visible browser window.
- Cross-process profile locking beyond what Playwright/Chromium enforces.
