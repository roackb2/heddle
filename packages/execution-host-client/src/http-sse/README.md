# Direct HTTP/SSE Execution Host client

This module owns a strict, transport-facing v1 client for local development and
reviewed direct HTTPS deployments. It validates the request before placing
credentials in headers, refuses redirects, incrementally parses bounded SSE,
binds invocation/run/sequence identity, requires `accepted` first and exactly
one terminal event, and withholds that terminal until clean EOF. Cancellation,
host rejection, invalid protocol, and ambiguous interruption remain distinct.

The adapter uses the Execution Host's direct local-token ingress. It does not
implement AWS AgentCore invocation, SigV4, retries, durable result recovery, or
product result projection. The official `../agentcore` module implements the
same `ExecutionHost` port without changing the adopter's application service.
