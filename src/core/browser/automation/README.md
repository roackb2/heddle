# Browser Automation Capability

This folder owns the user-facing Browser Automation switch.

Browser automation has two separate concerns:

- **Instruction activation**: whether future agent turns see the built-in
  `browser-automation` Agent Skill catalog entry and can read the full skill.
- **Default tool availability**: whether future default agent turns include the
  `browser_*` tool bundle.
- **Browser execution**: profiles, domain allowlists, evidence, policy, and
  Playwright driver behavior.

This service owns the first two concerns. It enables or disables the
workspace-scoped built-in skill by using `AgentSkillService`, and runtime tool
assembly checks the same activation state before injecting the browser toolkit.
It does not configure domains, select profiles, or weaken browser policy.

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

Logged-in websites still require a browser profile with a valid session. If no
session-backed profile is selected by the browser host/toolkit, agents should
assume only public pages are reachable.

## Boundaries

Owned here:

- Browser Automation enabled/disabled overview.
- Delegating activation to the built-in `browser-automation` Agent Skill.
- Exposing a shared activation check for default runtime tool assembly.
- Shared status vocabulary for slash commands and web settings.

Not owned here:

- Browser driver lifecycle, snapshots, evidence, and policy.
- Domain allowlists and forbidden browser actions.
- Profile creation, profile selection, or session validation.
- Web or terminal rendering details.

Future slices that add profile/domain settings should extend `src/core/browser`
policy/profile services rather than storing those settings in the skills
activation file.
