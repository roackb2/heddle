# Artifact Toolkit

The artifact toolkit adapts `src/core/artifacts` into ordinary Heddle tools.

It owns only runtime tool exposure:

- `artifact_dashboard`
- `list_artifacts`
- `read_artifact`
- `save_artifact`
- `set_current_artifact`

The toolkit does not own artifact persistence semantics. Keep storage, current
artifact pointers, id validation, and file paths in `src/core/artifacts`.
Runtime tool assembly decides whether this toolkit is included, and approvals
remain owned by `src/core/approvals`.

Artifact tools are general. Do not add presentation, report, diagram,
or dataset-specific behavior here. Put domain extraction or validation behind
host-provided tools/toolkits or a later artifact-awareness adapter.
