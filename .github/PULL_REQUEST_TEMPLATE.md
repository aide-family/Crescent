## Summary

- 

## Scope

- [ ] Renderer UI
- [ ] Main process / IPC
- [ ] Agent or tools
- [ ] Terminal / SSH
- [ ] Packaging / release
- [ ] Documentation

## Verification

- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Manual desktop smoke test

## Risk Review

- [ ] No secrets, API keys, passwords, hostnames, or private paths are included.
- [ ] Command execution, file writes, SSH, OpenAPI, and MCP behavior were reviewed if touched.
- [ ] User-visible changes are documented in README, release notes, or screenshots when needed.
