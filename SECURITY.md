# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for security-sensitive reports.

Use GitHub Security Advisories for private disclosure:

https://github.com/aide-family/Crescent/security/advisories/new

Include:

- Crescent version or commit SHA.
- Operating system and package type.
- Reproduction steps.
- Impact and affected capability, such as local Pi bash/file tools, SSH panes, model provider credentials, or knowledge-base storage.
- Relevant logs with secrets, hostnames, private paths, tokens, and passwords removed.

## Security-Sensitive Areas

Crescent embeds the [Pi coding agent](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`) in the Electron main process. Agent runs use Pi built-in tools against a configured workspace directory:

- `read` / `write` / `edit` — local filesystem access under the agent workspace cwd.
- `bash` — local shell execution with the user's privileges in that cwd (no agent command-approval gate in v1).
- Model provider API keys and custom OpenAI-compatible endpoints (via Pi `ModelRuntime`).
- Local knowledge-base and session persistence.

Manual terminal / SSH panes remain available for interactive use; the agent does **not** drive remote PTY sessions or OpenAPI/MCP tool runtimes in this release.

Changes in these areas should include tests or a clear manual verification note.

## Code signing

Release signing and notarization requirements are documented in [docs/CODE_SIGNING.md](./docs/CODE_SIGNING.md). Unsigned public builds remain available until certificate secrets are configured in CI.

## Maintainer Triage

- Confirm whether the report crosses a filesystem, shell, network, credential, or remote-state boundary.
- Reproduce with a minimal configuration and known workspace cwd.
- Check secret redaction, credential storage under `~/.crescent/pi-agent/`, and workspace path handling.
- Prefer a private patch and coordinated disclosure for confirmed vulnerabilities.
