# UI Design System

Crescent uses a compact iTerm-inspired desktop style. The goal is a quiet operational interface, not a marketing layout.

## Source Of Truth

- CSS tokens live in `src/renderer/src/assets/main.css`.
- Renderer color constants live in `src/renderer/src/lib/design-system.ts`.
- The accent color is `#13c2c2`.
- Terminal, code, and diagram surfaces should use the shared terminal tokens instead of hard-coded colors.

## Layout Rules

- Keep operational screens dense and scannable.
- Search and filter controls stay fixed; result lists scroll independently.
- Sticky section headers must touch the container edge when pinned.
- Avoid cards inside cards; use cards only for repeated items, modals, or framed tools.
- Use icons for compact repeated actions and keep text labels for primary commands.

## Component Rules

- Presentational UI belongs in `src/renderer/src/components`.
- Pure formatting, parsing, and theme constants belong in `src/renderer/src/lib`.
- Components receive plain props and callbacks; business effects stay in parent controllers or hooks.
- Repeated modals, status indicators, list rows, and settings editors should be extracted before adding new variants.

## Color Use

- `#13c2c2` is the action/focus accent, not a full-page background.
- Terminal surfaces stay near black with crisp borders.
- Secondary emphasis can use muted slate and restrained amber for notes.
- Do not introduce new dominant purple, beige, brown, or one-hue palettes.
