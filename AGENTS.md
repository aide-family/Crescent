# Agent instructions

Crescent is an Electron + electron-vite desktop operations workbench. Agents must follow the project rules in `.cursor/rules/` on every task.

Hard gates:

1. Run `npm run ci` (`lint`, `test`, `typecheck`, `build`) and get a green result before every git commit. Do not skip hooks.
2. Commit author is only the repository git user. Never add Cursor co-author trailers or `--author`.
3. Implement against `pi-dev`, `electron-dev`, `electron`, and `desktop-app-design`. Do not adopt Electron EGG (`ee-core`).

Read the matching skill and the installed pi package docs before changing `src/main/agent/` or Electron process boundaries.
