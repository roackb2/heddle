# First Run Review

Use this after the first real `repo-investigator` run so the project starts collecting comparable evidence instead of ad hoc impressions.

## Run Command

```sh
OPENAI_API_KEY=... yarn dev -- "What does this project do?"
```

## Capture

- Goal used:
- Model used:
- Date:
- Trace file:
- Outcome: `done` / `max_steps` / `error`
- Summary:

## Review Questions

- Did the agent gather enough evidence before answering?
- Did it repeat any file reads, searches, or shell commands?
- Did it choose the right tool for each step?
- Did it stop at the right time?
- Did the trace make the decision path easy to inspect?

## Failure Modes

- Repeated queries:
- Missing verification:
- Tool confusion:
- Infinite-loop tendency:
- Context loss:

## Changes To Consider

- Prompt changes:
- Tool description changes:
- Runtime changes:
- New tests to add:

## Decision Rule

Do not add a new runtime abstraction unless the trace shows a recurring failure mode and the proposed change clearly reduces either agent failure or developer debugging cost.
