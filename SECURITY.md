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

Crescent embeds the [Pi coding agent](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`) in the Electron main process. The host controls the active session and exposed tools:

- `read` / `write` / `edit` — local filesystem access with the user's privileges; relative paths resolve against the agent workspace cwd. The cwd is not a filesystem sandbox.
- `bash` — Crescent's visible PTY executor, including the connected SSH target. State-changing commands use the host's command approval gate; planned execution binds exact steps to the active target.
- MCP tools — configured stdio or HTTP servers, exposed through host-owned custom tools. Every tool invocation requires approval bound to the requesting window, run, terminal and target.
- Model provider API keys and custom OpenAI-compatible endpoints (via Pi `ModelRuntime`).
- Local knowledge-base and session persistence.

Manual terminal / SSH panes remain available for interactive use. OpenAPI configuration remains only for legacy migration; OpenAPI tools are not loaded into the Pi loop.

Credentials stay in the main process and are encrypted through Electron safeStorage. Encryption or decryption failure rejects the operation instead of falling back to plaintext or silently erasing credentials. Renderer configuration uses stored-value placeholders and connection-bound credential references. Crescent data directories use private permissions and logs redact sensitive text at their final sink.

Changes in these areas should include tests or a clear manual verification note.

## Code signing

Release signing and notarization requirements are documented in [Document/CODE_SIGNING.md](./Document/CODE_SIGNING.md). Unsigned public builds remain available until certificate secrets are configured in CI.

## Maintainer Triage

- Confirm whether the report crosses a filesystem, shell, network, credential, or remote-state boundary.
- Reproduce with a minimal configuration and known workspace cwd.
- Check secret redaction, credential storage under `~/.crescent/pi-agent/`, and workspace path handling.
- Prefer a private patch and coordinated disclosure for confirmed vulnerabilities.
