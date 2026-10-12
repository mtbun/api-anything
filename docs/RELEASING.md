# Releasing

Releases are published to npm by `.github/workflows/release.yml` when a version tag is pushed. Nothing is published from a laptop.

## Once

1. Create an npm automation token: npmjs.com → Access Tokens → Generate New Token → Automation.
2. Add it to the repository: Settings → Secrets and variables → Actions → New repository secret, name `NPM_TOKEN`.

## Each release

1. On a branch, move the `## [Unreleased]` entries in `CHANGELOG.md` under a new heading `## [1.0.0] - 2026-11-02` (version and date of the release) and leave an empty `## [Unreleased]` above it.
2. Set the version without tagging: `npm version 1.0.0 --no-git-tag-version`.
3. Open a pull request (`chore: release 1.0.0`) and merge it once CI passes.
4. Tag the merge commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag v1.0.0
   git push origin v1.0.0
   ```

The workflow checks that the tag matches `package.json`, that `CHANGELOG.md` has a section for the version, runs the type check and the tests, publishes with npm provenance, and creates the GitHub release with that section as its notes. If any step fails, nothing is published; fix it on `main`, delete the tag (`git push origin :v1.0.0` and `git tag -d v1.0.0`) and tag again.

## Before the first release

- `npm pack --dry-run` lists what the package ships: `bin/`, `src/`, `README.md`, `LICENSE`.
- Install the packed tarball in an empty directory and run `npx api-anything --version` and `npx api-anything analyze <capture.har>` to check the published command works.
