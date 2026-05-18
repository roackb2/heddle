# Browser Integration Tests

This folder contains Playwright tests that exercise the browser control plane
against a real Vite client and fixture daemon.

`web-v1/` covers the current production control plane. `web-v2/` covers the
parallel rebuild shell and should stay focused on browser-facing behavior as
that surface grows.

These tests are intended to run on every PR. They verify browser behavior,
frontend/server wiring, and file-backed fixture state without calling live model
providers. Agent execution is intentionally mocked by the fixture daemon.

Use `src/__tests__/e2e/` only for future true end-to-end tests that exercise
production-like runtime behavior without the browser-integration fake agent
path.
