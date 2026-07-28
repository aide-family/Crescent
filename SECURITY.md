# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for security-sensitive reports.

Use GitHub Security Advisories for private disclosure:

https://github.com/aide-family/Crescent/security/advisories/new

Include:

- Crescent version or commit SHA.
- Operating system and package type.
- Reproduction steps.
- Impact and affected capability, such as terminal command execution, SSH, local file access, OpenAPI, MCP, model provider credentials, or knowledge-base storage.
- Relevant logs with secrets, hostnames, private paths, tokens, and passwords removed.

## Security-Sensitive Areas

Crescent intentionally works near powerful local and remote capabilities:

- Terminal and sub-terminal command execution.
- SSH connections and credential prompts.
- Local file parsing and artifact writing.
- OpenAPI and MCP tool execution.
- Model provider API keys and custom endpoints.
- Local knowledge-base and session persistence.

Changes in these areas should include tests or a clear manual verification note.

## Maintainer Triage

- Confirm whether the report crosses a command, filesystem, network, credential, or remote-state boundary.
- Reproduce with a minimal configuration.
- Check command approval, tool catalog metadata, local file destination handling, and secret redaction behavior.
- Prefer a private patch and coordinated disclosure for confirmed vulnerabilities.
