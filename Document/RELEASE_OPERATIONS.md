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

   Dev notification branding (macOS): `postinstall` / `predev` run `scripts/patch-electron-dock-icon.cjs`, which (1) copies `build/icon.icns` over Electron’s `electron.icns`, and (2) rewrites `Electron.app` Info.plist `CFBundleName` / `CFBundleDisplayName` to `Crescent` and `CFBundleIdentifier` to `com.crescent.app` so Notification Center stops serving the cached Electron atom for `com.github.Electron`. Packaged apps are unaffected. After patching, fully quit the app once; if the left-slot icon is still stale, run `killall NotificationCenter` (or reboot) once.

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

## Code signing

Signed / notarized builds are optional until certificate secrets are configured. See [CODE_SIGNING.md](./CODE_SIGNING.md) for macOS Developer ID, notarization, and Windows Authenticode setup.

When secrets are present, the release workflow signs macOS (with notarization) and Windows installers automatically. Without secrets, unsigned artifacts are still published; macOS users may need the quarantine workaround documented in the README.

## Auto-update feed

Release assets must include electron-builder update metadata (`latest*.yml`, `.blockmap`) so the in-app updater can discover versions from GitHub Releases (`provider: github` in `electron-builder.yml`).

## Packaging smoke tests

After a local or CI package build, verify artifact layout:

```bash
npm run smoke:packaging
```

Optionally point at a directory of downloaded release assets:

```bash
npm run smoke:packaging -- ./release-assets
```

## Follow-up

- Check the GitHub Release assets are present and named by platform/architecture.
- Confirm `latest-mac.yml` / `latest.yml` / `latest-linux.yml` (as applicable) and `SHA256SUMS.txt` are attached.
- Run `npm run smoke:packaging` against the downloaded assets or `dist/`.
- Download at least one artifact for the target platform and confirm it starts.
- If publishing a prerelease, include a hyphen in the tag, for example `v1.2.0-beta.1`.
