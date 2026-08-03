# Crescent {{VERSION}}

Released on {{DATE}}.

Thank you for trying Crescent. This release includes desktop packages for macOS, Windows, and Linux so users can pick the installer that matches their environment.

> Crescent is an AI operations workbench for real terminal sessions, SSH workflows, Skills, Wiki SOPs, OpenAPI tools, and MCP integrations.

## Downloads

| Platform | Asset | Notes |
| --- | --- | --- |
| macOS Apple Silicon | `crescent-{{VERSION}}-arm64.dmg`, `.zip` | Native build for M-series Macs. |
| macOS Intel | `crescent-{{VERSION}}-x64.dmg`, `.zip` | Native build for Intel Macs. |
| macOS Universal | `crescent-{{VERSION}}-universal.dmg`, `.zip` | Single package for Apple Silicon and Intel Macs. |
| Windows | `crescent-{{VERSION}}-x64-setup.exe` | NSIS installer. |
| Linux | `crescent-{{VERSION}}-x64.AppImage`, `.deb` | Choose the package format used by your distribution. |
| Integrity | `SHA256SUMS.txt` | Verify downloaded files before installing. |

## Highlights

- Phase 4 distribution polish: in-app updates via GitHub Releases, packaging smoke checks, and optional CI signing when secrets are configured.
- Default local instruction files (`IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`) are seeded on first launch without overwriting existing files.
- Conversation like/dislike feedback is mutually exclusive once submitted.
- Session switcher clarity for peer terminals and active Agent execution.
- Architecture extractions for terminal tabs, xterm lifecycle, and connection form helpers.

## Install Notes

- Close the running Crescent app before installing this version.
- Verify downloads with `SHA256SUMS.txt` before installing.
- Keep a copy of important local configuration before upgrading across major versions.
- Review configured OpenAPI and MCP tools after upgrading, especially tools that can change remote state.

### macOS: “is damaged and can’t be opened”

Release builds are currently unsigned / not notarized. Gatekeeper may show **“Crescent” is damaged and can’t be opened** after a browser download. This is a quarantine warning, not a corrupt package.

1. Move `Crescent.app` into Applications.
2. Clear the quarantine attribute:

```bash
xattr -cr /Applications/Crescent.app
```

3. Open the app again.

More detail: see the install section in the repository README.

## Verification

```bash
shasum -a 256 -c SHA256SUMS.txt
```

## Feedback

Please report bugs or feature requests from the Issues page:

https://github.com/{{REPOSITORY}}/issues

Security reports should use GitHub Security Advisories rather than public issues.

## Maintainer Checklist

- Confirm the tag points to the intended `main` commit.
- Confirm all platform assets are attached to this release.
- Confirm `SHA256SUMS.txt` includes every downloadable package.
- Add highlights, breaking changes, or migration notes above when needed.
