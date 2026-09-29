# Anthropic Adapter

This service owns translation between Heddle's model-facing transcript and the
Anthropic Messages API. Model availability and effort policy live in
`src/core/llm/models/`, not here.

Claude 5 uses adaptive thinking by default. When a response requests Heddle
tools, the adapter saves its complete ordered assistant content blocks as
provider-private continuation and replays them unchanged with tool results.
That includes signed or redacted thinking blocks. The continuation is durable
in session history but never becomes user-visible text, trace content, or a
Heddle reasoning summary. The shared persistence schema validates its block
shape without dropping provider-added fields.

When Claude returns multiple `tool_use` blocks in one response, the adapter
replays one user message containing the corresponding tool results in call
order. The agent runtime may execute independent calls concurrently, including
host-approved mutations; a host can request serial execution with
`maxToolConcurrency: 1`.

The adapter selects only `text` for the visible answer and `tool_use` for tool
execution. It rejects incomplete `max_tokens` responses instead of treating
partial output as a finished turn. Current Claude 5 requests allow 16,384
output tokens at low–high effort and 64,000 at extra-high/max so adaptive
thinking has room to finish; older Claude requests retain the 4,096 cap.

To extend this boundary, update the model policy first, then the provider
request/response codec and replay schema. Keep model-specific wire fields out
of the generic agent loop and presentation layers.
