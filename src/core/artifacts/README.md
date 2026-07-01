# Artifacts

The artifacts domain owns Heddle-generated or host-provided output files that
should remain addressable across conversation turns.

Artifacts are not memory, traces, or tool results:

- memory stores durable knowledge for future reasoning;
- traces store evidence of what happened during a run;
- tool results are raw execution outputs;
- artifacts are reusable outputs that a user or host may preview, reopen, or
  ask the agent to modify in a follow-up turn.

This domain owns:

- the persisted artifact index under `stateRoot/artifacts/artifacts.json`;
- text-like artifact file storage under `stateRoot/artifacts/files/`;
- current artifact pointers for a workspace or session;
- repository validation for the on-disk JSON contract;
- service operations for save, list, read, and current-artifact selection.

This domain does not own:

- UI preview rendering;
- domain-specific parsing such as SlideX MotionDoc analysis;
- automatic promotion of arbitrary tool results into artifacts;
- runtime tool exposure for artifact operations.

Those behaviors should depend on this service boundary instead of reading or
writing artifact files directly.
