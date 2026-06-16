# Native Chrome Profile Service

This folder owns native Google Chrome launch and CDP health checks for Browser
Automation.

## Boundary

Native Chrome support has three separate responsibilities:

- `native-chrome/`: launches a Heddle-owned Chrome profile with a local
  `--remote-debugging-port`, checks whether the CDP endpoint is reachable, and
  records the selected profile/endpoint in browser settings after a successful
  launch.
- `chrome-cdp/`: attaches to an already-running CDP endpoint and implements
  browser actions such as open, snapshot, screenshot, and detach.
- `automation/`: exposes the user-facing Browser Automation switch, Settings
  page actions, and slash command orchestration.

Do not add site-specific URL repair, product knowledge, or browser action policy
here. This service is only allowed to prepare the browser process and verify the
local CDP endpoint. Browser actions and safety checks stay in the driver,
session, and policy modules.

## User Mental Model

Native Chrome mode is for sites that reject Playwright-launched browsers or need
the exact login behavior of locally installed Chrome.

1. The user enables Browser Automation.
2. The user selects `native-chrome-cdp`.
3. Heddle launches a Chrome window using a Heddle-owned profile directory under
   `.heddle/native-chrome-profiles/<profile-id>`.
4. The user logs in manually and keeps that Chrome window open.
5. Future browser tool runs attach to the configured local CDP endpoint.

The default validation URL is Wikipedia because it is meaningful enough for
browser snapshots and screenshots without requiring login or commerce actions.
