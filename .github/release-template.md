# Crescent {{VERSION}}

Released on {{DATE}}.

Thank you for trying Crescent. This release includes desktop packages for macOS, Windows, and Linux so users can pick the installer that matches their environment.

## Downloads

| Platform | Asset | Notes |
| --- | --- | --- |
| macOS | `.dmg`, `.zip` | Universal build for Apple Silicon and Intel Macs. |
| Windows | `.exe` | NSIS installer. |
| Linux | `.AppImage`, `.deb`, `.snap` | Choose the package format used by your distribution. |
| Integrity | `SHA256SUMS.txt` | Verify downloaded files before installing. |

## Upgrade Notes

- Close the running Crescent app before installing this version.
- If your OS warns about an unsigned application, review the downloaded file source and checksum before continuing.
- Keep a copy of important local configuration before upgrading across major versions.

## Verification

```bash
shasum -a 256 -c SHA256SUMS.txt
```

## Feedback

Please report bugs or feature requests from the Issues page:

https://github.com/{{REPOSITORY}}/issues

## Maintainer Checklist

- Confirm the tag points to the intended `main` commit.
- Confirm all platform assets are attached to this release.
- Confirm `SHA256SUMS.txt` includes every downloadable package.
- Add highlights, breaking changes, or migration notes above when needed.
