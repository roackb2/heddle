# Node adopter conveniences

This optional subpath removes repetitive Node backend plumbing while keeping
product policy in adopter code.

`NodeExecutionAdopterHttpService` owns:

- a public JWKS route and a prompt-only hosted-conversation route;
- bounded JSON parsing and stable safe errors;
- `Authorization` extraction plus normalized/raw-header redaction;
- SSE headers, framing, validation, and backpressure;
- request-disconnect cancellation and graceful active-request shutdown.

The service accepts callbacks for authentication, product admission, and turn
streaming. Those callbacks remain responsible for product authorization,
tenant/subject/session selection, durable invocation identity, result
settlement, and privacy-aware logging. Product MCP HTTP routing remains beside
the product's MCP tool implementation rather than inside this generic edge.

The key helpers generate disposable in-memory pairs, create owner-only local
development JWK files without overwriting, and load a private JWK into a
non-exportable signing key. Production secret storage, ACLs on Windows, key
rotation, revocation, and KMS/HSM policy remain deployment responsibilities.

`DirectExecutionHostCredentials` keeps the direct-host token and model API key
behind explicit methods and can take them out of caller-selected environment
variables at startup. The adopter still decides where production credentials
come from and whether passing a model key per invocation matches its trust
model.
