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

2. Update the package version in `package.json`.
3. Verify the release candidate on the intended commit.
4. Review the actual scope from git.
5. Write curated release notes from that real scope.
6. Create an annotated git tag on the shipped commit.
7. Push the commit and tag, then publish the GitHub release and npm package if intended.

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

1. Confirm the intended version in `package.json`.
2. Run the release verification baseline.
3. Review the git range since the previous release tag.
4. Update or draft the release note in `docs/releases/`.
5. Commit the release-ready state if needed.
6. Create the annotated tag on the shipped commit.
7. Push the commit and tag.
8. Publish the GitHub release body from the curated note.
9. Publish the npm package if that release is intended to ship publicly.

## Command Sequence

Typical release sequence:

```bash
yarn build
yarn test
npm pack --dry-run --cache /tmp/heddle-npm-cache
yarn release:context <previous-tag> HEAD
git tag -a vX.Y.Z -m "Heddle vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

If the repo does not have a previous tag yet, run `yarn release:context <base-ref> HEAD` with the intended release boundary instead.

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

## Agent Rule

When a coding agent is asked to do a release, it should:

- identify the previous release tag if one exists
- review the real diff and commit range
- verify the release candidate is green
- propose or apply the version bump
- create the annotated tag only for the actual release commit
- avoid inventing release scope from commit naming style alone
