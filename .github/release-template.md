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

- Graceful model quota handling: `AccountQuotaExceeded` / quota 429 stops blind retries and shows a human-readable quota card (provider + reset hint + switch-model shortcut) instead of raw JSON.
- Cursor-style agent timeline with coalesced thinking, tool results, and DeepSeek reasoning support.
- Pi bash runs in the visible PTY with in-chat high-risk command approvals (`kubectl delete` and other writes stay gated independently of model HTTP).
- Command classification funnel refinements and connection clarification UI for SSH / cluster login flows.
- Branding and icon asset updates; SSH connection intent matching restored for cluster login requests.

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
