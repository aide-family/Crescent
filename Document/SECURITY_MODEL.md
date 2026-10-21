# Crescent Security Model

This document records the expected security posture for the AI terminal workbench.

## Capability Boundaries

| Capability                 | Boundary                                                 | Expected Control                                                       |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Terminal command execution | Local or connected shell state                           | Command audit, approval for state-changing commands, watchdog timeouts |
| Sub-terminal execution     | Local temporary shell                                    | Same audit and timeout behavior as terminal execution                  |
| Local file writes          | Crescent client filesystem                               | User-supplied or confirmed destination, no implicit report path        |
| Local document parsing     | Crescent client filesystem                               | User-referenced path, extension-specific parsers                       |
| SSH connections            | Remote shell                                             | Explicit connection selection and user-driven credential prompt        |
| OpenAPI configuration      | Legacy migration data                                    | No OpenAPI tools exposed to the current Pi agent                       |
| MCP tools                  | Configured stdio or HTTP server with unverified behavior | Approval on every call, owner/run/pane/target binding, cancellation    |
| Model providers            | External AI endpoint                                     | API key storage and secret redaction in logs/UI                        |

## Tool Metadata

Tool catalog entries should describe:

- `source`: built-in, OpenAPI, or MCP.
- `risk`: low, medium, or high.
- `requiresApproval`: whether execution may require explicit user approval.
- `external`: whether the tool can call an external system.
- `stateChanging`: whether the tool can mutate local or remote state.

This metadata is advisory. Enforcement still belongs in command auditing, file destination validation, and the relevant executor.

## Electron and Credential Boundaries

- Renderer windows use sandboxing, context isolation and disabled Node integration. Preload exposes typed operations; generic IPC is not exposed.
- Main IPC handlers reject foreign origins and child frames, and cap payload size/complexity. Base64 attachments are bounded before decoding.
- Credentials are encrypted with safeStorage; unavailable encryption and failed decryption reject persistence. Linux's `basic_text` backend is not accepted.
- Provider keys and MCP environment/header values are replaced with stored-value placeholders. Connection passwords use opaque references consumed by main only at a live password prompt on their bound PTY.
- Command approvals, cancellation, steering and subterminal acknowledgments validate the owning window. MCP approval is revoked if the active run or target changes.
- Crescent's own data tree uses private modes without following symlinks. The final log sink redacts secrets.
- Media permissions allow explicit audio requests only. macOS entitlements retain JIT, audio input and user-selected files; signing/native-module compatibility still requires release validation.
- CI runs security boundary policy checks. Behavioral unit tests remain local-only under the repository policy; CI does not claim unit coverage. See [TESTING.md](TESTING.md).

## High-Risk Review Checklist

- Does the change execute commands, write files, call remote APIs, start MCP servers, or touch credentials?
- Are secrets excluded from logs, release artifacts, tests, and issue templates?
- Does the user see enough source, parameter, risk, and approval context before state changes?
- Are tests updated for command risk, path handling, provider config, or tool selection?
