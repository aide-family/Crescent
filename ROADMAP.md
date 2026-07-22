# Crescent Development Roadmap

Crescent is a desktop workbench that combines a local terminal with an OpenAPI-capable AI agent. The development route favors small, testable increments so every phase can be closed with automated verification.

## Phase 1 — Usable MVP

- Local terminal with PTY support and pipe fallback.
- User-configured provider/model settings with local key storage.
- OpenAPI document loading, function-tool generation, and HTTP execution.
- ReAct and Plan-and-Execute modes.
- Agent run panel with event log, answer output, and `/remember` support.
- Settings validation that parses the OpenAPI document and previews generated tools.

Exit checks:

```bash
npm run test
npm run typecheck
npm run build
```

## Phase 2 — Reliability and Observability

- Add request timeout/retry controls per OpenAPI host.
- Add redaction for sensitive request/response headers in event logs.
- Add exportable run traces for debugging tool calls.
- Add mock-server based integration tests for tool execution.

## Phase 3 — Workflow Productivity

- Multiple saved API profiles.
- Import OpenAPI from local files and remote URLs.
- Prompt templates and pinned workflows per API profile.
- Tool allow/deny list and per-operation confirmation rules.

## Phase 4 — Distribution Polish

- App update channel configuration.
- Signed builds per platform.
- First-run onboarding and example OpenAPI spec.
- Packaging smoke tests for macOS, Windows, and Linux.
