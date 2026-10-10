# UI Design System

Crescent uses a compact iTerm-inspired desktop style. The goal is a quiet operational interface, not a marketing layout.

## Source Of Truth

- Ordinary UI tokens live in `src/renderer/src/assets/theme.css`; component styles live in `main.css`.
- Library palettes live in `src/shared/theme-definitions.ts`, with a renderer re-export. Shared modules never import the renderer.
- `design-system.ts` holds theme-independent terminal typography only.
- Keep the four persisted IDs: `crescent` (Mission Control), `night-shift` (Phosphor Night), `route-survey` (Abyssal Route), `ink-signal` (Industrial Control).
- Use `useAppTheme()` for React visuals, and `subscribeAppTheme()` for imperative consumers. Xterm updates `options.theme` without recreating the terminal/session.
- Mermaid configuration is strict and serialized per render; cache keys include the theme. Offscreen diagrams repaint when visible. Chart and Architecture repaint with `useDiagramTheme()` after the first UI frame, keeping CSS and Xterm responsive. Architecture geometry keeps node kinds and paths separate from its palette; exports use the selected palette.

## Layout Rules

- Keep operational screens dense and scannable.
- Search and filter controls stay fixed; result lists scroll independently.
- Sticky section headers must touch the container edge when pinned.
- Avoid cards inside cards; use cards only for repeated items, modals, or framed tools.
- Interactive list tiles use `.app-list-row` with optional `data-selected="true"`. Idle background is `--background` (theme page); hover lifts via accent + primary-tinted border. Do not invent local `bg-card/70` / `hover:bg-muted/25` card classes.
- Use icons for compact repeated actions and keep text labels for primary commands.

## Component Rules

- Presentational UI belongs in `src/renderer/src/components`.
- Pure formatting, parsing, and theme constants belong in `src/renderer/src/lib`.
- Components receive plain props and callbacks; business effects stay in parent controllers or hooks.
- Repeated modals, status indicators, list rows, and settings editors should be extracted before adding new variants.

## Color Use

- The selected theme accent is for action/focus/selection, not a full-page background.
- Terminal surfaces stay near black with crisp borders.
- Secondary emphasis can use muted slate and restrained amber for notes.
- Error, warning, and success retain their meaning and accompanying labels/icons in every theme.
