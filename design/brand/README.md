# Crescent brand icons

## Master

| File | Role |
| --- | --- |
| `build/icons/crescent-logo.png` | **Production logo master** — iridescent 3D crescent in ring (transparent PNG) |

Legacy vector concepts (kept for reference, not used by packaging):

| File | Role |
| --- | --- |
| `build/icons/crescent-app.svg` | Older cyan-glow app icon concept |
| `build/icons/crescent-mark.svg` | Older flat teal mark concept |
| `build/icons/crescent-circuit.svg` | Marketing circuit variant |

Concept raster references live in `design/brand/concepts/`.

## Generate packaging assets

```bash
npm run icons
```

Requires `sharp` (devDependency). On macOS, `.icns` is built with system `iconutil`.

Writes:

- `build/icon.png` (1024×1024 master for electron-builder, charcoal `#0D1117` plate)
- `build/icon.icns` / `build/icon.ico`
- `resources/icon.png` (Electron window / dock in main process)
- `src/renderer/src/assets/crescent-logo.png` (favicon + ProductLogo)
- `src/renderer/src/assets/crescent-mark.png` (transparent UI mark)
- `build/icons/preview/icon-{16..1024}.png` (local QA only; gitignored)

## electron-builder

`electron-builder.yml` points at:

```yaml
mac:
  icon: build/icon.icns
win:
  icon: build/icon.ico
linux:
  icon: build/icon.png
```

`prebuild:mac*`, `prebuild:win`, and `prebuild:linux` run `npm run icons` so packaging always uses the latest logo master.

## Dark theme note

App packaging icons composite the transparent logo onto charcoal (`#0D1117`), not pure black, so cyan/blue highlights stay soft in dark-mode ops UIs (VS Code / terminal ecosystem).

## Rounded corners

`resources/icon.png` / `build/icon.*` bake a macOS-style squircle mask (transparent corners). This is required because Electron’s `app.dock.setIcon()` does not apply the system icon mask in development — without baked corners the Dock shows a sharp square.
