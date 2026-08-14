# Execution Host Client v6.0.0-next.1

This prerelease validates the automated release lane for
`@heddleagent/execution-host-client`. It does not change the package's runtime
API from `6.0.0-next.0`.

## What changed

- correct the package and current guides now that the v6 preview is publicly
  installable through npm's `next` channel;
- add a fail-closed release-state check that rejects changed package bytes
  under an already published version;
- publish an absent immutable version from a GitHub-hosted runner through npm
  trusted publishing and short-lived OIDC authority;
- verify the exact tarball integrity, channel movement, fresh JavaScript and
  TypeScript consumers, annotated package tag, and GitHub release; and
- make ordinary relevant merges and same-commit recovery runs idempotent.

The workflow stores no npm write token. npm trusted publishing automatically
records provenance for the public package. Publication remains restricted to
repository `roackb2/heddle`, workflow `publish-packages.yml`, environment
`npm-release`, and the protected `main` branch.

## Expected registry transition

Before this release, npm's required `latest` tag and the explicit `next` tag
both point to the first prerelease, `6.0.0-next.0`. Publishing this version must
advance only `next` to `6.0.0-next.1`; `latest` must remain at
`6.0.0-next.0`. The legacy `@roackb2/heddle-adopter@5.13.0` package remains
available and unchanged.

The release is selected by the version and this matching release note. Merging
the reviewed release PR to `main` is the publication action; no manual npm
publish command should follow it. If an infrastructure failure occurs, rerun
the same workflow commit so its immutable-version and integrity checks can
reconcile safely.
