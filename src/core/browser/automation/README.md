# Browser Automation Capability

This folder owns the user-facing Browser Automation switch.

Browser automation has separate concerns:

- **Instruction activation**: whether future agent turns see the built-in
  `browser-automation` Agent Skill catalog entry and can read the full skill.
- **Default tool availability**: whether future default agent turns include the
  `browser_*` tool bundle.
- **Browser execution settings**: which Heddle-owned browser profile and browser
  channel future browser turns use, and whether the Playwright session runs
  headless or headed.
- **Browser execution runtime**: profile locks, domain allowlists, evidence,
  policy, and Playwright driver behavior.

This service owns the first two concerns and exposes the execution settings
owned by `BrowserProfileSettingsService`. It enables or disables the
workspace-scoped built-in skill by using `AgentSkillService`, runtime tool
assembly checks the same activation state before injecting the browser toolkit,
and the injected toolkit reads the selected Heddle-owned profile, browser
channel, and display mode from `.heddle/browser/settings.json`.

It does not configure domains, weaken browser policy, or render per-run
evidence.

Browser Automation is a host-owned capability, so it must resolve the packaged
built-in skill directly. Project or user Agent Skills named `browser-automation`
remain ordinary skills; they must not shadow the capability switch or the
guidance future browser-tool runs receive.

## User Mental Model

Users see Browser Automation as a capability they can turn on for a workspace.
When it is on, Heddle teaches the agent when browser automation is appropriate:
visual inspection for frontend work, user-requested website automation, web
research, and workflows where rendered browser state matters. Future default
agent turns also receive `browser_open`, `browser_snapshot`, `browser_click`,
`browser_screenshot`, and `browser_close`.

If no explicit domain allowlist is configured, the first successful
`browser_open` URL establishes the same-domain browsing boundary for that
browser session. This lets a user enable useful browser work without granting an
unrestricted cross-site browser.

Logged-in websites still require a Heddle-owned browser profile with a valid
session. Users can open the selected profile in a manual visible window from
Settings or `/browser open-profile [url]`, log in manually, close that window,
and then let future agent browser runs reuse the saved session. Headed/headless
mode controls future agent browser runs; the manual profile window always opens
visible.

## Boundaries

Owned here:

- Browser Automation enabled/disabled overview.
- Delegating activation to the built-in `browser-automation` Agent Skill.
- Browser profile id, browser channel, and headless/headed settings for future
  default browser turns.
- Opening/closing the selected manual profile window through the browser-domain
  profile window service.
- Exposing a shared activation check for default runtime tool assembly.
- Shared status vocabulary for slash commands and web settings.

Not owned here:

- Browser driver lifecycle, snapshots, evidence, and policy.
- Domain allowlists and forbidden browser actions.
- Session validation inside a selected browser profile.
- Web or terminal rendering details.

Future slices that add domain policy settings or evidence previews should extend
`src/core/browser` policy/evidence services rather than storing those settings
in the skills activation file.
