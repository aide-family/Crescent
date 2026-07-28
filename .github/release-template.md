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

- AI Agent beside a real terminal.
- Local terminal and SSH connection workflows.
- Command review flow for risky operations.
- Skills and Wiki knowledge-base support for repeatable SOPs.
- OpenAPI and MCP tool integrations.

## Upgrade Notes

- Close the running Crescent app before installing this version.
- If your OS warns about an unsigned application, review the downloaded file source and checksum before continuing.
- Keep a copy of important local configuration before upgrading across major versions.
- Review configured OpenAPI and MCP tools after upgrading, especially tools that can change remote state.

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
