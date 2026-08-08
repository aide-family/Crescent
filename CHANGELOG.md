# Changelog

## v1.0.3 (Unreleased)

### Features

- Batch readonly bash scripts in a single tool call: quote-aware split, separator injection, structured output for the model and Timeline.
- Expand READONLY classification for common kubectl/docker/linux/systemctl inspection commands.
- Skill template scaffold: `skill_templates` SQLite table plus `agent:list-skill-templates` / `agent:save-skill-template` IPC (UI editor Coming in v1.1).

### Improvements

- Replace soft “batch collection” system-prompt rules with a short hard rule that multi-readonly acquisition must share one bash call.

## v1.0.2

### Hotfix

- Dropped macOS universal packaging from release CI and local scripts; ship separate arm64 and x64 mac builds instead (native `.node` modules kept failing universal merge).
