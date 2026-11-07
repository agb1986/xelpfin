# Commits and versioning

This repo uses Conventional Commits and semantic versioning. The version is derived from the
commit history, so the commit message is what decides the next release number.

## Commit messages

Format: `<type>(<optional scope>): <summary>`, imperative mood, lower case after the colon, no
trailing full stop, summary under about 72 characters. Add a body when the why is not obvious.

| Type | Use for | Version bump |
|---|---|---|
| `feat` | A user-visible capability | minor |
| `fix` | A user-visible bug fix | patch |
| `perf` | Performance improvement | patch |
| `feat!`, `fix!`, or a `BREAKING CHANGE:` footer | Incompatible change (stored settings, sign-in, server API assumptions, app id) | major |
| `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `style` | No user-visible change | none |

Pick the type from the effect on the user, not from the files touched. A change that only
touches tests or docs is never `feat` or `fix`. Split unrelated changes into separate commits so
each one carries a single type. Scopes are optional; useful ones are `player`, `backend`, `ui`,
`platform`, `android`, `vega`, `scripts`.

While the version is below 1.0.0, a breaking change still uses `!` but is released as a minor bump
unless the user asks for `1.0.0`.

## Never edit the version by hand

`package.json` is the only place the version lives. `versionName` and `versionCode` in
`android/app/build.gradle` are derived from it, and `scripts/release.sh` names the APKs from it.
Do not change `version` in `package.json`, `package-lock.json` or `build.gradle` in a normal
commit.

## Releasing

Only when the user asks for a release, from a clean `main`:

1. `npm run verify`, so the release is not cut from a broken tree.
2. `npm run version:dry-run` and show the user the proposed version and changelog.
3. `npm run version:bump`. This bumps `package.json` and the lockfile, writes `CHANGELOG.md`,
   commits `chore(release): vX.Y.Z` and creates the `vX.Y.Z` tag. Use
   `npm run version:bump -- --release-as <patch|minor|major|X.Y.Z>` only when the user names the
   level.
4. `npm run apk:release` if the user wants the APKs.
5. Do not push the commit or the tag until the user says to (`git push --follow-tags`).

Never create or move a `v*` tag by hand, and never retag a version that was already pushed.
`versionCode` is `major*10000 + minor*100 + patch`, so keep minor and patch below 100.

## Attribution

Commit messages end with the `Co-Authored-By: Claude ... <noreply@anthropic.com>` trailer the
harness provides. Never add a `Claude-Session:` trailer or a `claude.ai/code/session_...` link.
