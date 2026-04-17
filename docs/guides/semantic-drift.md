# Semantic Drift

Heddle can show whether the agent's responses are drifting away from the recent semantic trajectory of the conversation.

The CyberLoop workflow is observe-only. Drift telemetry is enabled by default for new chat sessions when `cyberloop` is available.

## What Heddle Does

When CyberLoop is available, Heddle can:

- load CyberLoop kinematics middleware
- embed assistant output frames
- compare the current response trajectory against the previous assistant response when available
- show `drift=unknown|low|medium|high` in the chat footer
- highlight medium/high drift in the status bar
- write `cyberloop.annotation` events into saved traces

Tool outputs are excluded from chat drift scoring so the signal focuses on where the agent's own responses are heading.

## Notes

- Chat drift uses a more sensitive default stability threshold than CyberLoop's library default.
- Set `HEDDLE_DRIFT_STABILITY_THRESHOLD` if you want to tune it.
- The toggle is saved on the active chat session.
- `/drift` reports the last unavailable reason if the middleware or embeddings fail.

Heddle does not calculate semantic drift itself. For the underlying methodology, see the [CyberLoop repository](https://github.com/roackb2/cyberloop) and [paper](https://zenodo.org/records/18138161).

## See Also

- [Chat and sessions](chat-and-sessions.md)
- [Programmatic use](programmatic-use.md)
