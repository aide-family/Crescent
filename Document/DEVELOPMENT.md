# 开发与 Mac 打包规范

本规范落实 2026-10-11 的用户要求，后续版本持续遵守：**Mac 只交付 Universal 包**。同一个 `Crescent.app` 同时包含 Intel x64（Mach-O 名称 `x86_64`）和 Apple Silicon arm64；DMG 和 ZIP 均装载这一份 Universal 应用。不得把两个独立架构安装包放进同一目录冒充 Universal。Windows 适配、构建与验收不列入当前开发范围。

## 开发门禁

- 遵循根目录 `AGENTS.md`、`.cursor/rules/` 和项目 `pi-dev` / `electron-development` skills。变更 Agent 或进程边界前，阅读已安装 Pi SDK 文档与类型。
- main 持有 OS、SSH、文件、数据与秘密；preload 只暴露验证过的 IPC；renderer 不访问 Node/文件系统。Pi 通过既有 lazy SDK facade 加载。
- 保留现有 host 计划执行器。新自动审批仅放行确定性、无变更且已有用户授权的操作；实际变更仍需人工确认或人工执行。
- 本地验证禁止连接生产环境实施变更，不自动提交、push、发布。不纳入明文密码、Token、原始敏感终端日志或用户配置。
- 运行 `npm run ci` 和 `npm run test:local`；测试文件保持 gitignored，禁止提交。测试规则见 [TESTING.md](TESTING.md)。

## 标准打包入口

```sh
npm run build:mac:local
```

此入口先运行完整 CI 和本地测试，再串行构建和打包，只生成：

```text
dist/local-macos/universal/mac-universal/Crescent.app
dist/local-macos/universal/crescent-<version>-universal.dmg
dist/local-macos/universal/Crescent-<version>-universal-mac.zip
```

`build:mac:unsigned`、`build:mac:local:universal` 以及旧的 `build:mac:local:x64` / `:arm64` 都转到这一入口。旧 `build:mac:x64` / `:arm64` 则转到 `build:mac`，同样只生成 Universal。本地脚本的旧架构参数也统一映射为 Universal；`electron-builder.yml` 的 Mac DMG/ZIP 目标都明确设置 `arch: [universal]`。发布 workflow 也仅保留一个 Mac Universal 构建行，固定 `--mac --universal`；本轮不触发远程 workflow 或发布。

`build:unpack` 固定为 Mac Universal 应用目录构建，并先运行完整本地门禁。`npm run build:mac` 是需要预先配置签名身份与公证凭据的打包入口，固定 `--universal --publish never`。它也先运行 `npm run verify:local`，通过完整门禁后才打包。签名和公证需要联网且需另行安排；不会因打包而自动发布。

本地入口剔除继承的 Apple/签名凭据、禁用 signing / notarization / hardened runtime，并显式使用 `--publish never`。本地包供开发验证，不能据此宣称发行签名、公证或 Gatekeeper 验收成功。可用 `CRESCENT_LOCAL_BUILD_DIR` 指定 `dist/` 内的独立输出根目录，其下仍只有 `universal/`。

## Universal 原生依赖约束

保留 `asarUnpack` 对 node-pty、Pi、MCP SDK、Pi WASM 等运行资源的规则；保留 `mergeASARs: false` 和精确 `x64ArchFiles`，不要通过删除原生模块或粗放扩大 unpack 范围解决合并问题。

node-pty 和 Pi native prebuilds 必须包含两架构；通用 esbuild 可执行文件由原生准备脚本合并。Electron 主可执行文件和通用 esbuild 都必须可通过 `lipo -archs` 检查出 `x86_64 arm64`。PDF.js 和 worker 已打入 renderer，不将可选 native canvas 加入运行包。

打包开始后必须冻结 `out/`，不得同时运行 CI/build 或另一个打包任务去重写输入。Mac 入口不自动清空整个 `dist/`；需要清理时只清理自己确认不再使用的输出目录。

## 离线构建

在可信联网准备机完成锁定依赖安装及 postinstall，预热当前锁定 Electron 的 **darwin-x64 和 darwin-arm64 两份 ZIP**、electron-builder DMG 工具和锁定 esbuild Darwin tarball 缓存。默认缓存在 `~/Library/Caches/electron`、`~/Library/Caches/electron-builder`；可通过 `ELECTRON_CACHE` / `ELECTRON_BUILDER_CACHE` 指定。还需携带兼容的 Node、源码/lockfile、node_modules 和 native prebuilds。esbuild 缓存优先使用 `node_modules/.cache/crescent-native/` 已校验 tarball；本地脚本的 npm 缓存位于 `out/implementation/npm-cache`，也应一起准备。不得携带个人配置、凭据或生产日志。

```sh
CRESCENT_OFFLINE_BUILD=1 npm run build:mac:local
```

离线入口检查两架构 Electron、DMG 工具和 native 缓存；缺少资源直接失败。esbuild tarball 以 lockfile SRI 校验，离线时不回退网络下载。使用已经安装好的依赖与本地资源；离线机不能以缺依赖的 `npm ci` 代替缓存准备。依赖或 Electron 版本升级后必须重新预热缓存。

## 产物验收

1. 确认只交付一套 Universal `.app` / DMG / ZIP，主程序和 esbuild 含两架构，node-pty / Pi native prebuilds 齐全。
2. 执行 `hdiutil verify <dmg>` 与 `unzip -tq <zip>`，记录 DMG/ZIP 的 SHA-256；确认包内 Pi/MCP 可以从 unpacked 路径加载、PDF lazy chunk 和本地 worker 存在。
3. 从实际打包应用用隔离的 `CRESCENT_DATA_DIR` / `CRESCENT_USER_DATA_DIR` 验证 Pi runtime、原生 PTY、host 只读命令与文档流程；禁止使用生产连接和真实敏感日志做夹具。
4. Intel 与 Apple Silicon 的实际运行分别记录。单台 Intel Mac 的静态 arm64 检查不能替代 Apple Silicon 真机验收。正式分发另需签名、公证与 Gatekeeper 验证。

本轮 A～H 修复和验收证据见 [专项改造验收记录](Crescent_v1.0.11_专项改造验收记录_20261010.md)。
