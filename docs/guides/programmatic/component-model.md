# Heddle Component and Deployment Model

Heddle can run inside a product backend or behind a separate Execution Host.
The agent loop is the same kind of runtime in both shapes; the deployment and
trust boundaries are different.

This distinction matters because three similar terms describe different
things:

- the **Heddle runtime** is the model, tool, conversation, approval, trace, and
  artifact machinery shipped by `@roackb2/heddle`;
- **hosted runs** are public lifecycle utilities for addressable, reconnectable
  runs inside an adopter-owned long-lived process;
- a **Heddle Execution Host** is a separately deployed application that embeds
  the Heddle runtime and is invoked through a language-neutral network
  contract.

“Hosted” in a package path does not mean Heddle operates a cloud service.
Similarly, the Heddle runtime is application code and should not be confused
with a cloud provider product such as AWS AgentCore Runtime.

## Choose one primary shape

| Shape | Where Heddle runs | Start with | Best fit |
| --- | --- | --- | --- |
| Embedded SDK | In your TypeScript/Node backend | `@roackb2/heddle` | The backend may import Heddle and should directly own tools, storage adapters, policy, and UI integration |
| Adopter-hosted run service | In your long-lived TypeScript/Node server or worker | `@roackb2/heddle/hosted`, optionally `@roackb2/heddle-remote` | A turn must outlive one request, support reconnect/cancel, or stream to another process while remaining inside your deployment |
| Separate Execution Host | In an independently deployed compatible host | `@roackb2/heddle-adopter` or the published OpenAPI/JSON Schema contract | The product backend uses another language or needs the agent workstation isolated from product data and infrastructure |
| Heddle coding agent | In the local CLI, daemon, and browser control plane | `heddle` | You want to use or inspect Heddle as a finished coding-agent product before embedding the SDK |

The first two shapes are normal public SDK integration. The third is a public
adopter contract plus reference machinery; it is not a publicly distributed
Execution Host or a Heddle-operated service.

## Dependency and trust boundaries

```mermaid
flowchart LR
  subgraph embedded["Embedded or adopter-hosted process"]
    product["Product backend"] --> hosted["Optional hosted-run lifecycle"]
    hosted --> sdk["Heddle SDK and runtime"]
    product --> sdk
  end

  subgraph separate["Separate Execution Host shape"]
    backend["Adopter backend"] -->|"v1 assertion + invocation + SSE"| host["Compatible Execution Host"]
    host --> runtime["Heddle runtime"]
    host -->|"invocation-bound MCP capability"| mcp["Adopter MCP tools"]
    mcp --> productdata["Adopter APIs and data"]
  end
```

In the separate-host shape, only the Execution Host imports Heddle. The adopter
backend can use any language that implements the published contract. It owns
end-user authentication, authorization, tenant mapping, durable invocation
identity, signing-key operations, product MCP behavior, result application,
and product data. The Execution Host receives short-lived authority and the
exact MCP capability selected for one invocation; it should not receive an
adopter database credential.

## Public availability

| Component | Status | What the status means |
| --- | --- | --- |
| `@roackb2/heddle` and `/hosted` | Public | TypeScript/Node SDK and runtime surfaces for adopter-owned processes |
| `@roackb2/heddle-remote` | Public | Browser-safe run protocol and optional HTTP/SSE client |
| `@roackb2/heddle-adopter` | Public, experimental | TypeScript reference SDK plus canonical OpenAPI, JSON Schema, fixtures, and an independent Python v1 conformance proof |
| Compatible Heddle Execution Host | Private research | A proving ground for isolated hosted execution and deployment evidence; it is not distributed or offered as a service |
| AWS AgentCore deployment | Private research target | One way to test managed session isolation and lifecycle behavior, not a requirement of the public contract |

The public claim is deliberately bounded: Heddle defines and tests how a
language-neutral adopter integrates with a compatible Execution Host. It does
not claim that a managed Heddle hosting product is available.

## Continue by goal

- Embed the runtime: [SDK quickstart](quickstart.md).
- Choose the narrowest in-process layer:
  [programmatic integration layers](integration-layers.md).
- Build reconnectable runs in your own server:
  [hosted agent stack](../../../examples/sdk/05-hosted-agent/README.md).
- Integrate a backend with a separate host:
  [Execution Host adopter backend](execution-host-adopters.md).
- Implement the network contract outside TypeScript:
  [v1 language-neutral specification](../../../packages/heddle-adopter/spec/v1/README.md).

