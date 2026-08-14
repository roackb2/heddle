// ===========================================================================
// Heddle — Heartbeat adapter verification (`@heddleagent/runtime/heartbeat/testing`)
// ===========================================================================
// This opt-in entrypoint contains executable contract scenarios for custom
// persistence adapters. It stays outside the runtime entrypoints so production
// bundles do not acquire adapter-fixture code merely by importing heartbeat.
// ===========================================================================

export {
  HeartbeatTaskStoreConformance,
  HeartbeatTaskStoreConformanceError,
} from './core/heartbeat/tasks/heartbeat-task-store-conformance.js';
export type {
  HeartbeatTaskStoreConformanceCapabilities,
  HeartbeatTaskStoreConformanceHarness,
  HeartbeatTaskStoreConformanceScenario,
} from './core/heartbeat/tasks/heartbeat-task-store-conformance.js';
