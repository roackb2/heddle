# `@heddleagent/runtime` 6.5.0

This release gives hosted checkpoint integrations a Heddle-owned memory-change
signal instead of requiring each host to inspect tool names or tool payloads.

## What changed

- add `result.memory.changed` to completed conversation-turn results;
- derive that fact from Heddle memory events owned by the conversation engine;
- wait for configured post-turn memory maintenance to reach a stable boundary
  before the returned turn promise reports the change; and
- preserve streamed assistant output while background maintenance settles after
  primary turn persistence.

## Upgrade note

Checkpointing hosts can combine `result.memory.changed` with their own terminal
outcome policy. They no longer need to recognize Heddle memory tool names or
decode tool-specific result payloads.
