# Release Notes

This folder defines the release convention for Heddle.

Heddle should not rely on blank templates or commit-prefix inference as the source of truth for releases.

The source of truth for a release is:

- the explicit operator decision to ship a version
- the actual git range since the previous release tag
- the verified release commit that gets tagged

`unreleased.md` may stage user-facing notes while features are under review.
Release preparation must reconcile that draft against the actual git range,
move the shipped content into the chosen version file, and leave behind only
items that were not included.

## Release Convention

For a user-facing release:

1. Choose the version to ship.
2. Check the latest published npm version and existing GitHub tags/releases so you do not reuse an already shipped version.
3. Update only the selected `@heddleagent/*` package manifest. The deprecated
   `@roackb2/*` packages are frozen at `5.13.0`; their source remains
   recoverable from that release tag and they are not part of another 5.x
   release. The five stable `@heddleagent/*` packages documented in
   [`packages/README.md`](../../packages/README.md) use independent release
   lanes and never inherit a root-package version implicitly.
4. Verify the release candidate on the intended commit.
5. Review the actual scope from git.
6. Write curated release notes from that real scope.
7. Create an annotated git tag on the shipped commit.
8. Push the commit and tag, then create the GitHub release from the curated release note.
9. Keep npm publishing as a final manual operator step for every package.
   Merging to `main` does not tag, publish, or create a GitHub release.

## Verification Baseline

Before tagging a release, use the normal green checkpoint baseline:

- `yarn build`
- `yarn test`
- `npm pack --dry-run --cache /tmp/heddle-npm-cache`

Add more verification if the release changes a workflow that needs manual validation.

## Manual v6 Package Publication

The five `@heddleagent/*` packages are independently versioned, but all use the
same deliberately manual release shape:

1. bump only the package being released and write its curated release note;
2. run that package's normal build, tests, and pack check;
3. merge the reviewed release commit to `main`;
4. create and push an annotated package-specific tag;
5. create the GitHub release from the curated note;
6. confirm `npm whoami` is the owning account;
7. run `npm publish <package-directory> --access public --tag latest`; and
8. verify the exact version and `latest` dist-tag with `npm view`.

npm may require an interactive browser or OTP approval. Publication is not a
CI responsibility, and merging to `main` never implies that npm succeeded. If
the publish command ends ambiguously, check the exact version with `npm view`
before trying again.

Use these package-specific checks and publish commands:

| Package | Verification | Manual publication | Annotated tag |
| --- | --- | --- | --- |
| `@heddleagent/run-client` | `yarn run-client:pack:verify` | `npm publish ./packages/run-client --access public --tag latest` | `run-client-v<version>` |
| `@heddleagent/runtime` | `yarn runtime:pack:verify` | `npm publish ./packages/runtime --access public --tag latest` | `runtime-v<version>` |
| `@heddleagent/cli` | `yarn cli:pack:verify` | `npm publish ./packages/cli --access public --tag latest` | `cli-v<version>` |
| `@heddleagent/execution-host-client` | `yarn execution-host-client:test && yarn execution-host-client:conformance:python-v1 && yarn execution-host-client:pack:verify` | `npm publish ./packages/execution-host-client --access public --tag latest` | `execution-host-client-v<version>` |
| `@heddleagent/postgres` | `HEDDLE_POSTGRES_TEST_URL=postgresql:///heddle_test yarn postgres:test && yarn postgres:pack:verify` | `npm publish ./packages/postgres --access public --tag latest` | `postgres-v<version>` |

Publish a changed runtime before a CLI version that depends on it. Publish a
changed Execution Host client before a PostgreSQL adapter version that depends
on it. Apply the PostgreSQL package's ordered migration to the explicit test
database before its real-database test.

The pack checks never publish or mutate registry state. Stable publication
moves `latest`; any historical prerelease tag remains independent. Keep the
published `@roackb2/*` packages available for already-installed consumers, but
do not release new 5.x versions as part of the v6 package family.

## Fast Release Preflight

Before spending time on the full build/test/pack baseline, check the auth- and
environment-sensitive release steps that most often fail late:

```bash
gh auth status
git config --get tag.gpgSign
```

If multiple GitHub accounts are configured, decide the release account first
and switch early:

```bash
gh auth switch -u <username>
gh api user
```

If the intended account may need release creation and does not already have the
right scopes, refresh before the long verification pass:

```bash
gh auth refresh -h github.com -s workflow
```

This does not replace the normal release verification baseline. It exists to
catch predictable release-environment failures before the long verification pass.

## Git Range Review

Release notes should be written from the actual change range, usually:

```bash
git log --oneline <previous-tag>..HEAD
git diff --stat <previous-tag>..HEAD
```

A minimal helper is also available:

```bash
yarn release:context <previous-tag> HEAD
```

This prints the commit subjects and diff stat for the requested release range. Treat it as source material only.

If the repo has no prior release tag yet, treat the first tagged release as the baseline and review the intended scope manually.

## Tagging Rule

Use annotated tags in the format:

```bash
git tag -a vX.Y.Z -m "Heddle vX.Y.Z"
```

The release tag should point at the actual released commit.
Do not infer release boundaries from version-bump commit messages alone when an explicit tag can define the boundary.

## Release Execution Checklist

For the actual release pass:

1. Confirm the latest already-published version on npm and the latest GitHub release/tag.
2. Confirm the intended next version in the selected `@heddleagent/*` package
   manifest.
3. Run the release verification baseline.
4. Review the git range since the previous release tag.
5. Update or draft the release note in `docs/releases/`.
6. Commit the release-ready state if needed.
7. Create the annotated tag on the shipped commit.
8. Push the commit and tag.
9. Create the GitHub release body from the curated note.
10. Stop and hand off to the operator for `npm publish`, unless the operator explicitly asks the agent to publish.

## Command Sequence

Typical release sequence:

```bash
gh release list --limit 5
gh auth status
gh auth switch -u <username-if-needed>
gh api user
yarn build
yarn test
npm pack --dry-run --cache /tmp/heddle-npm-cache
yarn release:context <previous-tag> HEAD
git tag -a vX.Y.Z -m "Heddle vX.Y.Z"
git push origin main
git push origin vX.Y.Z
gh release create vX.Y.Z --title "Heddle vX.Y.Z" --notes-file docs/releases/vX.Y.Z.md
```

Before a package's first publication, its `npm view` command is expected to
return `E404`; confirm the package name is genuinely unregistered rather than
treating that first-release state as a failed preflight.

If the repo does not have a previous tag yet, run `yarn release:context <base-ref> HEAD` with the intended release boundary instead.

## GitHub CLI Auth Notes

Release commands that use GitHub or npm credentials should be treated as auth-sensitive. In agent environments, sandboxed shell commands may not have the same keyring, credential helper, or network access as the operator's normal terminal.

If sandboxed `gh auth status`, `gh release list`, or `gh release create` reports invalid credentials while the operator's terminal shows a valid active account, rerun the GitHub command through the normal authenticated shell context or request an unsandboxed/escalated execution path. Do not stop the release solely because sandboxed `gh` cannot see the keyring-backed token.

In this repo's real release workflow, this has happened repeatedly: the
operator's normal shell had valid keyring-backed `gh` auth, while the
agent/constrained shell reported invalid tokens. Treat the operator's normal
authenticated shell as the source of truth for `gh` auth state.

If `gh release create` fails with a scope or account error, check the active GitHub CLI account before starting a new auth flow:

```bash
gh auth status
```

This machine may have multiple authenticated GitHub accounts. If the account with the needed scope is already present but inactive, switch to it:

```bash
gh auth switch -u <username>
```

For release creation, the active account needs enough repository access and may need `workflow` scope. If the correct account exists but lacks scope, refresh that same account:

```bash
gh auth refresh -h github.com -s workflow
```

During device login, make sure the browser authorizes the same account that `gh auth refresh` is trying to update. If `gh` expects one account but the browser grants another, the refresh will fail with an account mismatch. In that case, either switch to the already-authorized account with the right scope or rerun the refresh while logged into the intended GitHub account in the browser.

If `gh auth status` shows more than one valid account, do not assume the
currently active one is the release account. Explicitly switch to the intended
account and verify it with:

```bash
gh auth switch -u <username>
gh api user
```

For this repository, make sure the account creating the GitHub release is the
one that owns or can publish releases for `roackb2/heddle`.

Do not claim the release sequence is complete until the GitHub release object
actually exists. A pushed commit and pushed tag are not the end of the flow.

## Annotated Tagging Notes

Annotated release tags are still the rule, but local tag creation may fail in
agent or constrained-shell environments even when normal git pushes work.

Common failure modes:

- GPG signing enabled but the local `gpg-agent` is unavailable.
- constrained shells cannot create temporary files under the local GnuPG home.
- the tagging shell has different permissions from the operator's normal shell.

If annotated tag creation fails with GPG- or temp-file-related errors, do not
redo the whole release pass. Use the normal authenticated shell context or an
unsandboxed execution path for the tag operation, then continue from the
already-verified release commit.

## Writing Rule

Final release notes should be curated, short, and user-facing.
They should explain:

- what changed for users
- why the change matters
- any upgrade or workflow notes
- any meaningful limits or early edges

Do not just paste a raw commit list as the final release body.
Do not rely on commit prefixes alone to decide the release narrative.

## Optional Helper

If a script exists to summarize the git range, treat it as source material only.
The final release notes should still be written from the actual scope plus the intended release goal.

Current example release note drafts:

- [`v0.0.23.md`](./v0.0.23.md)
- [`v0.0.24.md`](./v0.0.24.md)
- [`v0.0.25.md`](./v0.0.25.md)
- [`v0.0.26.md`](./v0.0.26.md)
- [`v0.0.27.md`](./v0.0.27.md)
- [`v0.0.28.md`](./v0.0.28.md)
- [`v0.0.29.md`](./v0.0.29.md)
- [`v0.0.30.md`](./v0.0.30.md)
- [`v0.0.31.md`](./v0.0.31.md)
- [`v0.0.32.md`](./v0.0.32.md)
- [`v0.0.33.md`](./v0.0.33.md)
- [`v0.0.34.md`](./v0.0.34.md)
- [`v0.0.35.md`](./v0.0.35.md)
- [`v0.0.38.md`](./v0.0.38.md)
- [`v1.0.0.md`](./v1.0.0.md)
- [`v1.0.1.md`](./v1.0.1.md)
- [`v1.0.2.md`](./v1.0.2.md)
- [`v1.0.3.md`](./v1.0.3.md)
- [`v1.1.0.md`](./v1.1.0.md)
- [`v1.2.0.md`](./v1.2.0.md)
- [`v1.3.0.md`](./v1.3.0.md)
- [`v1.4.0.md`](./v1.4.0.md)
- [`v1.5.0.md`](./v1.5.0.md)
- [`v1.6.0.md`](./v1.6.0.md)
- [`v1.7.0.md`](./v1.7.0.md)
- [`v1.8.0.md`](./v1.8.0.md)
- [`v1.8.1.md`](./v1.8.1.md)
- [`v1.9.0.md`](./v1.9.0.md)
- [`v1.10.0.md`](./v1.10.0.md)
- [`v1.11.0.md`](./v1.11.0.md)
- [`v1.12.0.md`](./v1.12.0.md)
- [`v1.13.0.md`](./v1.13.0.md)
- [`v2.0.0.md`](./v2.0.0.md)
- [`v2.1.0.md`](./v2.1.0.md)
- [`v2.2.0.md`](./v2.2.0.md)
- [`v2.3.0.md`](./v2.3.0.md)
- [`v2.4.0.md`](./v2.4.0.md)
- [`v2.5.0.md`](./v2.5.0.md)
- [`v3.0.0.md`](./v3.0.0.md)
- [`v3.1.0.md`](./v3.1.0.md)
- [`v4.0.0.md`](./v4.0.0.md)
- [`v4.1.0.md`](./v4.1.0.md)
- [`v4.2.0.md`](./v4.2.0.md)
- [`v4.3.0.md`](./v4.3.0.md)
- [`v4.4.0.md`](./v4.4.0.md)
- [`v4.5.0.md`](./v4.5.0.md)

## Agent Rule

When a coding agent is asked to do a release, it should:

- preflight `gh` auth and active account before the long verification pass
- identify the previous release tag if one exists
- review the real diff and commit range
- verify the release candidate is green
- propose or apply the version bump
- create the annotated tag only for the actual release commit
- push the release commit and tag
- create the GitHub release from the curated release note
- verify that the GitHub release object actually exists before reporting the
  release sequence complete
- leave `npm publish` as the final operator action unless explicitly delegated
- avoid inventing release scope from commit naming style alone
