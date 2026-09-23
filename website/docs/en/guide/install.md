# Install

<LatestDownloads locale="en" />

## macOS: “is damaged and can’t be opened”

Until repository signing secrets are configured, some release builds may still be unsigned. See [docs/CODE_SIGNING.md](https://github.com/aide-family/Crescent/blob/main/docs/CODE_SIGNING.md) in the repository.

After a browser download, Gatekeeper may say **“Crescent” is damaged and can’t be opened**. The package is not corrupt. Move `Crescent.app` into Applications, then clear the quarantine attribute:

```bash
xattr -cr /Applications/Crescent.app
```

You can also check **System Settings → Privacy & Security** for an “Open Anyway” option. If that fails, use the `xattr` command above.

## Install from source

From a clone of the repository:

```bash
npm install
```

Local development and packaging are covered in [Run from source and contribute](/en/develop/).
