// Omitted maxSteps should not be a practical default ceiling. Hosts that need a
// hard budget should pass maxSteps explicitly at their boundary.
export const DEFAULT_MAX_STEPS = Number.MAX_SAFE_INTEGER;
export const STREAM_UPDATE_INTERVAL_MS = 75;
export const INTERRUPTED_SUMMARY = 'Run interrupted by host request';
