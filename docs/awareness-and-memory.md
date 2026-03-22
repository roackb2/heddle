# Awareness And Memory

This document defines the smallest useful shape for Heddle's next two support layers:

- situation awareness
- knowledge persistence

It is intentionally a design document, not an implementation plan. The goal is to make the boundaries clear without locking the runtime into premature abstractions.

## Why This Exists

Current traces show that a minimal execution loop plus tools is enough for simple tasks, but it becomes inefficient when the agent must first discover what parts of the environment matter.

That is not just a prompt problem. It is the absence of a general awareness layer.

At the same time, some information should survive across runs:

- durable findings
- user or org conventions
- summaries of prior investigation
- artifacts that help future runs start from a better baseline

That is the role of knowledge persistence.

These concerns are related, but they are not the same thing.

## Working Distinction

### Situation Awareness

Situation awareness is current-task perception of the environment.

It should help the agent answer questions like:

- what exists here?
- what is relevant to this goal?
- what changed since last time?
- what should I inspect first?
- what observations are worth holding in working context right now?

Situation awareness is not limited to code. The same pattern should support code, infrastructure, documents, design artifacts, or other domains through adapters.

### Knowledge Persistence

Knowledge persistence is durable memory across runs, sessions, or agents.

It should store things like:

- durable summaries
- workspace notes
- user or org preferences
- stable domain knowledge
- prior findings that may help future awareness

Persistent knowledge can bootstrap awareness, but it should not replace fresh observation of the current environment.

### Working Memory

Working memory is the transient bridge inside a single run.

It can hold:

- recent observations
- candidate relevant surfaces
- temporary summaries
- unresolved questions

Working memory is runtime state. Knowledge persistence is durable storage.

## Design Goal

Keep the core loop generic.

The run loop should not need to know what a repo, service, dashboard, or design file is. It should only know that awareness and persistence can be consulted through stable interfaces.

That suggests:

- a small `AwarenessProvider` contract
- a small `KnowledgeStore` contract
- domain adapters that implement awareness for code, infra, docs, or other environments

## Tool Design Principle

The agent-facing tool layer must stay more concrete than the architecture layer.

Terms like `AwarenessProvider` and `KnowledgeStore` are useful for system design, but they are not necessarily good tool names. Agents need tools with simple, legible mental models and predictable behavior.

The default rule is:

- architecture terms explain why a subsystem exists
- tool names explain what the agent can do right now

Examples:

- good architecture terms: `AwarenessProvider`, `KnowledgeStore`
- good agent-facing tool names: `list_artifacts`, `search_artifacts`, `read_artifact`, `summarize_changes`, `suggest_starting_points`, `search_notes`, `save_note`

Avoid exposing vague agent-facing tools with names like `understand_environment` or `find_relevant_context` unless the behavior is narrow enough to be predictable from the name alone.

## Mental Model Rule

Agent tools should feel like stable instruments, not smart assistants.

Even when the implementation is sophisticated, the tool contract should still communicate a clear mental model:

- deterministic vs heuristic
- exhaustive vs best-effort
- raw results vs synthesized suggestions

Good tools usually fit one of a few simple shapes:

- enumerate
- filter
- search
- read
- summarize
- transform
- suggest

Blending too many of those behaviors behind one vague verb makes the tool harder for agents to use correctly.

One practical consequence is that Heddle should be cautious about inventing wrappers for every external system. If an existing tool already has a mature and legible interface, exposing it through a safe environment adapter may be better than creating a new bespoke tool with fuzzier semantics.

## Inspectable By Default

Heuristic outputs should always be easy to verify with simpler deterministic tools.

For example:

- `suggest_starting_points` suggests likely places to inspect
- `read_artifact` verifies one target directly
- `search_artifacts` broadens or checks the evidence

This keeps the system legible. A heuristic tool can help the agent start faster, but it should not behave like an opaque oracle.

## AwarenessProvider

An awareness provider helps the runtime or agent gather and summarize current-environment evidence for a goal.

It should be able to:

- describe what surfaces exist in the environment
- suggest where to look first for a specific goal
- summarize recent or important changes when change awareness exists
- turn raw environment state into compact observations

Minimal conceptual shape:

```ts
export type AwarenessQuery = {
  goal: string;
  domain?: string;
  scope?: string[];
};

export type AwarenessObservation = {
  kind: string;
  summary: string;
  source?: string;
  confidence?: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
};

export type AwarenessSuggestion = {
  type: 'inspect' | 'search' | 'verify';
  target: string;
  reason: string;
};

export type AwarenessSnapshot = {
  observations: AwarenessObservation[];
  suggestedNextLookups: AwarenessSuggestion[];
};

export interface AwarenessProvider {
  describeEnvironment?(query: AwarenessQuery): Promise<AwarenessSnapshot>;
  findRelevantContext(query: AwarenessQuery): Promise<AwarenessSnapshot>;
  summarizeChanges?(query: AwarenessQuery): Promise<AwarenessSnapshot>;
}
```

This is intentionally narrow:

- it returns observations and suggested next lookups
- it does not replace the core tool loop
- it does not force a planning ontology
- it does not assume retrieval must be semantic, lexical, indexed, or shell-based

Different adapters can implement it differently.

Examples:

- a code adapter might use files, symbols, diffs, or an index
- an infra adapter might use services, logs, metrics, or deployment state
- a docs adapter might use document trees, metadata, and text search

This is an internal interface shape, not a recommended agent-facing tool vocabulary.

An adapter may expose this capability to the agent through clearer tool contracts such as:

- `list_artifacts`
- `search_artifacts`
- `summarize_changes`
- `suggest_starting_points`

Those names communicate behavior more directly than the architecture term `findRelevantContext`.

## KnowledgeStore

A knowledge store is durable memory scoped to a tenant, workspace, project, or task family.

It should be able to:

- save durable notes or summaries
- retrieve prior relevant notes
- list known memories in a scope
- support deletion or expiration later without changing the interface shape

Minimal conceptual shape:

```ts
export type KnowledgeScope = {
  tenantId: string;
  workspaceId?: string;
  projectId?: string;
  namespace?: string;
};

export type KnowledgeRecord = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type KnowledgeQuery = {
  scope: KnowledgeScope;
  query: string;
  tags?: string[];
  limit?: number;
};

export interface KnowledgeStore {
  search(query: KnowledgeQuery): Promise<KnowledgeRecord[]>;
  save(scope: KnowledgeScope, record: Omit<KnowledgeRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<KnowledgeRecord>;
  list(scope: KnowledgeScope, options?: { limit?: number; tags?: string[] }): Promise<KnowledgeRecord[]>;
}
```

This interface deliberately avoids overcommitting to storage internals:

- records could live in markdown files during local development
- records could live in object storage plus an index in a hosted product
- search could be lexical, structural, semantic, or hybrid

The interface should preserve those options.

Agent-facing persistence tools should follow the same rule. Prefer concrete verbs like:

- `search_notes`
- `save_note`
- `list_notes`

over abstract names like `query_memory` unless the behavior is equally clear.

## Relationship Between Them

The intended data flow is:

1. awareness inspects the current environment
2. the agent forms working memory from those observations
3. the run may consult prior knowledge for bootstrap context
4. durable findings can be written back to the knowledge store after the run

In other words:

- awareness is mainly read-oriented and current-state oriented
- knowledge persistence is durable and cross-run oriented

They can inform each other, but they should remain separate interfaces.

## What Should Stay Out Of Core

The core runtime should not hardcode:

- repo-specific routing hints
- code-only concepts such as files or symbols
- a mandatory planning phase system
- a fixed storage backend
- a requirement that awareness always use indexing

Those belong in adapters, policies, or hosted-service infrastructure.

The core runtime should also avoid leaking architecture vocabulary directly into the agent-facing tool layer unless the term is behaviorally obvious.

## Code Adapter As One Example

A code adapter may eventually implement awareness with capabilities such as:

- workspace surface summary
- likely relevant files or modules for a goal
- change summary from git state
- symbol-aware lookup
- retrieval from file content, structure, or index

That should be treated as one domain adapter, not the definition of the framework.

At the tool boundary, the preferred approach is still to expose a small number of legible operations with familiar mental models, not a single opaque "understand the repo" command.

The likely near-term pattern is:

- structured tools for high-frequency CRUD-style operations with very clear semantics
- shell or other environment adapters for the long tail of domain-specific capabilities and edge cases

That keeps the agent-facing surface compact without forcing the framework to wrap every existing operational tool.

## Storage Direction

The hosted product should assume multi-tenant deployment and strong privacy boundaries.

That suggests a storage design where:

- durable knowledge is scoped by tenant and workspace
- privacy and isolation are enforced at the service boundary
- agents interact through familiar list, read, and search semantics
- the backend remains free to use object storage, metadata tables, and indexes rather than a literal shared filesystem

The interface should remain compatible with both:

- local file-backed development
- hosted distributed storage

## Promotion Rule

Do not implement these interfaces because they sound elegant.

Implement them only when traces show recurring failure modes that the current loop plus tools cannot address cleanly.

For now, this document is the boundary definition to guide future work.
