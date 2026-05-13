# Coding Project Detectors

This folder owns ecosystem-specific project detection for coding awareness.

## Responsibility

- Detect supported project kinds from bounded, evidence-backed workspace signals.
- Contribute normalized project signals to the coding awareness domain.
- Keep ecosystem-specific rules out of the generic `project_signals` contract.

## Boundary

- Detectors may inspect a bounded set of known manifest or config files.
- Detectors must not read arbitrary source files or guess frameworks from code content.
- Hosts and tools must not call detectors directly; they are internal to coding awareness.
- The coding awareness collector owns composition and output shaping; detectors only contribute normalized signals.

## Current Supported Project Kinds

- `javascript`
- `python`
- `go`

## Roadmap

Planned next additions when evidence justifies them:

- `rust`
- `ruby`
- `java`
- `android`
- `ios`

## Current Compromise

These detectors are still hardcoded rules. That is acceptable for the first slice because the supported set is intentionally small and reviewable.

Do not keep scaling this folder indefinitely by hand once project-type coverage becomes broad or brittle. When Heddle needs wider ecosystem coverage, the next architectural step should be a dedicated project-inspection agent or similarly bounded inspection subsystem that can derive project type and verification surfaces more flexibly without baking endless framework rules into core code.
