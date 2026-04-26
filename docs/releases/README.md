# Release Notes

This folder defines the release convention for Heddle.

Heddle should not rely on blank templates or commit-prefix inference as the source of truth for releases.

The source of truth for a release is:

- the explicit operator decision to ship a version
- the actual git range since the previous release tag
- the verified release commit that gets tagged

## Release Convention

For a user-facing release:

1. Choose the version to ship.
2. Check the latest published npm version and existing GitHub tags/releases so you do not reuse an already shipped version.
3. Update the package version in `package.json`.
4. Verify the release candidate on the intended commit.
5. Review the actual scope from git.
6. Write curated release notes from that real scope.
7. Create an annotated git tag on the shipped commit.
8. Push the commit and tag, then create the GitHub release from the curated release note.
9. Leave npm publishing as the final manual operator step unless the operator explicitly asks the agent to publish to npm.

## Verification Baseline

Before tagging a release, use the normal green checkpoint baseline:

- `yarn build`
- `yarn test`
- `npm pack --dry-run --cache /tmp/heddle-npm-cache`

Add more verification if the release changes a workflow that needs manual validation.

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
2. Confirm the intended next version in `package.json`.
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
npm view @roackb2/heddle version
gh release list --limit 5
yarn build
yarn test
npm pack --dry-run --cache /tmp/heddle-npm-cache
yarn release:context <previous-tag> HEAD
git tag -a vX.Y.Z -m "Heddle vX.Y.Z"
git push origin main
git push origin vX.Y.Z
gh release create vX.Y.Z --title "Heddle vX.Y.Z" --notes-file docs/releases/vX.Y.Z.md
```

If the repo does not have a previous tag yet, run `yarn release:context <base-ref> HEAD` with the intended release boundary instead.

## GitHub CLI Auth Notes

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

## Agent Rule

When a coding agent is asked to do a release, it should:

- identify the previous release tag if one exists
- review the real diff and commit range
- verify the release candidate is green
- propose or apply the version bump
- create the annotated tag only for the actual release commit
- push the release commit and tag
- create the GitHub release from the curated release note
- leave `npm publish` as the final operator action unless explicitly delegated
- avoid inventing release scope from commit naming style alone
