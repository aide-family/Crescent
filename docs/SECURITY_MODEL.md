# Crescent Security Model

This document records the expected security posture for the AI terminal workbench.

## Capability Boundaries

| Capability                 | Boundary                                                  | Expected Control                                                       |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Terminal command execution | Local or connected shell state                            | Command audit, approval for state-changing commands, watchdog timeouts |
| Sub-terminal execution     | Local temporary shell                                     | Same audit and timeout behavior as terminal execution                  |
| Local file writes          | Crescent client filesystem                                | User-supplied or confirmed destination, no implicit report path        |
| Local document parsing     | Crescent client filesystem                                | User-referenced path, extension-specific parsers                       |
| SSH connections            | Remote shell                                              | Explicit connection selection and user-driven credential prompt        |
| OpenAPI tools              | External HTTP API                                         | Tool catalog display and provider configuration review                 |
| MCP tools                  | Local stdio server with arbitrary server-defined behavior | Server allowlist by configuration and tool catalog display             |
| Model providers            | External AI endpoint                                      | API key storage and secret redaction in logs/UI                        |

## Tool Metadata

Tool catalog entries should describe:

- `source`: built-in, OpenAPI, or MCP.
- `risk`: low, medium, or high.
- `requiresApproval`: whether execution may require explicit user approval.
- `external`: whether the tool can call an external system.
- `stateChanging`: whether the tool can mutate local or remote state.

This metadata is advisory. Enforcement still belongs in command auditing, file destination validation, and the relevant executor.

## High-Risk Review Checklist

- Does the change execute commands, write files, call remote APIs, start MCP servers, or touch credentials?
- Are secrets excluded from logs, release artifacts, tests, and issue templates?
- Does the user see enough source, parameter, risk, and approval context before state changes?
- Are tests updated for command risk, path handling, provider config, or tool selection?
