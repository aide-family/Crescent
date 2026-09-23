# 从源码运行与贡献

产品说明的仓库原文是 [README.zh-CN.md](https://github.com/aide-family/Crescent/blob/main/README.zh-CN.md)。下面的命令在仓库根目录执行。

早期版本的 OpenAPI 与 MCP 已从 Agent 循环中移除。设置里若仍能看到相关项，只用于旧配置迁移，模型不能再把它们当作当前工具。

## 安装依赖并启动

```bash
npm install
npm run dev
```

## 打包

```bash
# Windows（可在 macOS / Linux 上交叉打包，依赖 node-pty 的 win32 prebuilds）
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

打包使用 `node-pty` 的 N-API prebuilds，并关闭 `npmRebuild`，因此在 macOS 上不会去交叉编译 Windows 或 Linux 原生模块。正式发版由 GitHub Actions 在对应系统上构建。若本机打 Windows NSIS 包时提示缺少 Wine，改用 CI，或先安装 Wine。

## 文档站

文档源码在 `website/`。本地预览和构建：

```bash
npm run docs:dev
npm run docs:build
```

推送到 `main` 且变更了 `website/` 时，GitHub Actions 会把静态站点部署到 GitHub Pages。仓库需要在 Settings → Pages 中把 Source 设为 GitHub Actions。

## 仓库里的工程文档

这些文件仍在仓库中维护，站点不复制正文：

- [签名与公证](https://github.com/aide-family/Crescent/blob/main/docs/CODE_SIGNING.md)
- [路线图](https://github.com/aide-family/Crescent/blob/main/ROADMAP.md)
- [架构](https://github.com/aide-family/Crescent/blob/main/docs/ARCHITECTURE.md)
- [测试](https://github.com/aide-family/Crescent/blob/main/docs/TESTING.md)

## 参与

- 仓库：<https://github.com/aide-family/Crescent>
- 问题与需求：<https://github.com/aide-family/Crescent/issues>

欢迎提交 Issue、Pull Request，或把常用排障流程整理成 Skill。
