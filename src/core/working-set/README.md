# Working Set

The working-set domain owns portable continuity for an agent's current,
free-form work across independent Runtime executions. It is separate from
memory: working files describe unfinished focus and intermediate artifacts;
memory describes durable knowledge and preferences.

The first public boundary is the provider-neutral checkpoint service under
[`checkpoint/`](checkpoint/README.md). Hosts decide when a working directory is
made available to tools and which stable verified identity owns it.

This domain does not define a product workflow, task schema, prompt convention,
cloud adapter, or provider filesystem layout.
