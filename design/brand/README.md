# Crescent brand icons

## Masters (vector)

| File | Role |
| --- | --- |
| `build/icons/crescent-app.svg` | **Production app icon** — cyan glow crescent + `>_` on charcoal `#0D1117` |
| `build/icons/crescent-mark.svg` | **In-app / favicon mark** — flat teal crescent + `>` (transparent) |
| `build/icons/crescent-circuit.svg` | Marketing variant (circuit crescent); not used for dock sizes |

Concept raster references live in `design/brand/concepts/`.

## Generate packaging assets

```bash
npm run icons
```

Requires `sharp` (devDependency). On macOS, `.icns` is built with system `iconutil`.

Writes:

- `build/icon.png` (1024×1024 master for electron-builder)
- `build/icon.icns` / `build/icon.ico`
- `resources/icon.png` (Electron window / dock in main process)
- `src/renderer/src/assets/crescent-logo.svg` (favicon + ProductLogo)
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

`prebuild:mac*`, `prebuild:win`, and `prebuild:linux` run `npm run icons` so packaging always uses the latest SVG masters.

## Dark theme note

Background intentionally uses charcoal (`#0D1117`), not pure black, so cyan/blue glow stays soft in dark-mode ops UIs (VS Code / terminal ecosystem).
