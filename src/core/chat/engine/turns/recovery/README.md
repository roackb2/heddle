# Turn Context Recovery

This folder owns the conversation-engine response to a provider-confirmed
context-window rejection.

`ConversationTurnContextRecoveryService` force-compacts the exact transcript
that the provider rejected, persists the archive-backed result under the
active session lease, and returns a replacement transcript for one retry of
that same model request.

The boundary deliberately does not run an agent turn or execute tools. Tool
effects completed before the rejection remain in the transcript and are never
replayed by recovery. Provider usage remains authoritative telemetry after a
successful request; local token estimates are only an earlier optimization.
