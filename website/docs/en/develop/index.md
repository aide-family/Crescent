# Run from source and contribute

The repository overview is [README.md](https://github.com/aide-family/Crescent/blob/main/README.md). Run the commands below from the repository root.

OpenAPI and MCP from earlier versions are no longer part of the Agent loop. If those settings are still visible, they exist only so old configuration can migrate. The model cannot call them as current tools.

## Install dependencies and start

```bash
npm install
npm run dev
```

## Package

```bash
# Windows (cross-packaging from macOS or Linux uses node-pty win32 prebuilds)
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Packaging uses `node-pty` N-API prebuilds with `npmRebuild` disabled, so macOS does not cross-compile Windows or Linux native modules. Official releases build each platform on its native runner. If a local Windows NSIS build asks for Wine, use CI or install Wine first.

## Docs site

Docs sources live in `website/`. Preview and build locally:

```bash
npm run docs:dev
npm run docs:build
```

Pushes to `main` that change `website/` deploy the static site with GitHub Actions. In the repository, set Settings → Pages → Source to GitHub Actions.

## Engineering docs in the repo

These files stay in the repository. The site links to them instead of copying the text:

- [Code signing](https://github.com/aide-family/Crescent/blob/main/docs/CODE_SIGNING.md)
- [Roadmap](https://github.com/aide-family/Crescent/blob/main/ROADMAP.md)
- [Architecture](https://github.com/aide-family/Crescent/blob/main/docs/ARCHITECTURE.md)
- [Testing](https://github.com/aide-family/Crescent/blob/main/docs/TESTING.md)

## Contribute

- Repository: <https://github.com/aide-family/Crescent>
- Bugs and requests: <https://github.com/aide-family/Crescent/issues>

Issues, pull requests, and reusable operational Skills are welcome.
