# Changelog

## v1.0.2

### Hotfix

- Extended mac `x64ArchFiles` to `**/*.node` so universal merges keep identical arch-specific natives (node-pty, pi-tui, `@mariozechner/clipboard-darwin-*`, etc.) instead of failing with “same in both x64 and arm64 builds”.
- Release CI now checks that the universal app’s unpacked `.node` files exist and Darwin natives are readable Mach-O; single-arch binaries are expected and valid under this packaging model.
