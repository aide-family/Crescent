# Release Operations

Crescent releases are tag-driven product releases, not ad-hoc CI artifacts.

## Release Decision

- Only tags matching `v*` publish GitHub Releases.
- Release tags must point to commits contained in `main`.
- CI validates typecheck, lint, tests, and build before regular changes are merged.
- Release workflow builds macOS, Windows, and Linux downloadable artifacts and publishes checksums.

## Preflight

1. Confirm the intended commit is on `main`.
2. Run:

   ```bash
   npm run typecheck
   npm run lint
   npm run test
   npm run build
   ```

3. Confirm `.github/release-template.md` has any release-specific notes updated.
4. Confirm `electron-builder.yml` targets match the platforms being announced.
5. Create and push a version tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

## Artifact Expectations

- macOS: `dmg` and `zip` artifacts for supported architectures.
- Windows: installer artifacts from electron-builder.
- Linux: `AppImage` and `deb` artifacts from the release workflow.
- `SHA256SUMS.txt` must be attached to the release.

## Follow-up

- Check the GitHub Release assets are present and named by platform/architecture.
- Download at least one artifact for the target platform and confirm it starts.
- If publishing a prerelease, include a hyphen in the tag, for example `v1.2.0-beta.1`.
