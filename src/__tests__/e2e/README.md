# End-To-End Tests

This folder is reserved for true end-to-end tests.

Use it for tests that exercise the packaged or production-like Heddle path with
real runtime behavior across the CLI, daemon/server, browser, storage, and agent
execution boundaries.

Do not put browser tests here when they use a fixture daemon or mocked agent
execution. Those belong in `src/__tests__/browser-integration/`.
