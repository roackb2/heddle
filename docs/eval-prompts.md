# Eval Prompts

Use this prompt set to exercise `examples/repo-investigator.ts` against the Heddle repo in a way that surfaces different execution-loop behaviors.

## Current Batch

1. `What does this project do?`
2. `Where is the agent loop implemented, and how does it stop?`
3. `What built-in tools does this runtime expose, and what are their safety limits?`
4. `Which files define tracing behavior, and how do they relate to each other?`
5. `Compare README.md and docs/framework-vision.md: what is the current implementation scope vs the long-term goal?`

## What This Batch Is For

- prompt 1 checks simple grounded summarization
- prompt 2 checks targeted code navigation
- prompt 3 checks tool/safety synthesis
- prompt 4 checks multi-file relationship tracing
- prompt 5 checks cross-document comparison and scope reasoning

## Review Focus

For each run, capture:

- step count
- whether the answer was grounded in the right files
- wrong-tool calls
- repeated or low-value calls
- whether shell was used unnecessarily or helpfully
- whether assistant rationale before tool calls was visible and useful
