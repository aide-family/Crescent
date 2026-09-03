# Agent instructions

Crescent is an Electron + electron-vite desktop operations workbench. Agents must follow the project rules in `.cursor/rules/` on every task.

Hard gates:

1. Before every git commit: run `npm run ci` and, when local test files exist, `npm run test:local`. Do not skip hooks. Unit tests are **local-only** (see `docs/TESTING.md`); `*.test.ts` files must not be committed.
2. Commit author is only the repository git user. Never add Cursor co-author trailers or `--author`.
3. Follow project skills `pi-dev`, `electron-development`, `electron`, and `desktop-app-design`. Do not adopt Electron EGG (`ee-core`). Do not patch a single symptom without fitting Pi host tools and Electron process boundaries.

Read the matching skill and the installed pi package docs before changing `src/main/agent/` or Electron process boundaries.
