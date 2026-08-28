# `@heddleagent/runtime` 6.7.0

This release lets adopter backends reuse an existing Heddle OpenAI/Codex
account login across an authenticated execution boundary without giving the
isolated Runtime any OAuth refresh material.

## What changed

- add `RuntimeCredentialService.acquireRequestScopedCredentialForModel` for
  OpenAI-backed models;
- resolve the canonical credential store from a Heddle `stateRoot`, while
  retaining an explicit `storePath` option for custom repositories and tests;
- refresh near-expiry OAuth credentials at the host boundary, serialize
  concurrent refreshes per credential store, and persist the refreshed account
  credential before returning; and
- return only the request-scoped access token, expiry, and optional account
  identifier. Refresh tokens never enter the returned Runtime shape.

The method accepts an abort signal and configurable refresh window so a host can
acquire a credential that remains valid for its bounded invocation rather than
discovering expiry after work has started.

## Upgrade note

Adopter backends that already use Heddle's credential store can replace custom
OAuth-file parsing or refresh logic with the new service. Keep API-key and
OAuth credential paths explicit: this API returns `undefined` for unsupported
providers or a store without a compatible OpenAI account login.

The host remains responsible for authenticating and authorizing the invocation,
redacting credentials, and sending the returned access-token-only shape over a
trusted transport.

## Verification

Credential tests cover valid reuse, refresh and persistence, concurrent
acquisition, abort handling, invalid refresh windows, and missing or
incompatible credentials.
