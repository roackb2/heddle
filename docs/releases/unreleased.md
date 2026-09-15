# Unreleased

## Runtime

- Custom recurring heartbeat handlers can prefer one earlier next run after a
  successful agent result. The claim-fenced scheduler keeps the configured
  periodic deadline as the maximum interval and preserves external run-request,
  retry, recovery, terminal, and cancellation semantics.
