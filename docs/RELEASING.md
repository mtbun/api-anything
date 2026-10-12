# Releasing

Releases are published to npm by `.github/workflows/release.yml` when a version tag is pushed. Nothing is published from a laptop, and nothing is published without the maintainer's approval.

## Safeguards

- **No stored npm token.** The workflow publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): npm trusts this repository's release workflow directly and issues a short-lived credential for each run. There is no long-lived token to leak or rotate.
- **Approval before publishing.** The job runs in the `npm` environment, which requires the maintainer to approve the run in the Actions tab before any step executes.
- **Only the maintainer can create release tags.** A tag ruleset limits creating, moving and deleting `v*` tags to repository admins.
- **Secrets never reach pull requests from forks.** GitHub does not pass repository secrets or OIDC credentials to workflows triggered by forked pull requests.

## Once: connect npm to this repository

npm configures trusted publishers on an existing package. For the very first release:

1. Create a granular access token on npmjs.com with publish permission, valid for a few days.
2. Add it to the repository as the secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).
3. Release 1.0.0 as below.
4. On npmjs.com, open the package → Settings → Trusted Publisher → GitHub Actions, and enter owner `mtbun`, repository `api-anything`, workflow `release.yml`, environment `npm`.
5. Delete the `NPM_TOKEN` secret and revoke the token. From now on releases need no token.

If npm already lets you add the trusted publisher before the first release, skip steps 1, 2 and 5.

## Each release

1. On a branch, move the `## [Unreleased]` entries in `CHANGELOG.md` under a new heading such as `## [1.0.0] - 2026-11-02` and leave an empty `## [Unreleased]` above it.
2. Set the version without tagging: `npm version 1.0.0 --no-git-tag-version`.
3. Open a pull request (`chore: release 1.0.0`) and merge it once CI passes.
4. Tag the merge commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag v1.0.0
   git push origin v1.0.0
   ```

5. Approve the run in the Actions tab (Review deployments → npm → Approve).

The workflow checks that the tag matches `package.json`, that `CHANGELOG.md` has a section for the version, runs the type check and the tests, publishes with npm provenance, and creates the GitHub release with that section as its notes. If any step fails, nothing is published; fix it on `main`, delete the tag (`git push origin :v1.0.0` and `git tag -d v1.0.0`) and tag again.

## Before the first release

- `npm pack --dry-run` lists what the package ships: `bin/`, `src/`, `README.md`, `LICENSE`.
- Install the packed tarball in an empty directory and run `npx api-anything --version` and `npx api-anything analyze <capture.har>` to check the published command works.
