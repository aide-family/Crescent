# 安装

普通使用从 [GitHub Releases](https://github.com/aide-family/Crescent/releases) 下载对应平台的安装包。

| 平台                | 推荐资产                   |
| ------------------- | -------------------------- |
| macOS Apple Silicon | `crescent-*-arm64.dmg`     |
| macOS Intel         | `crescent-*-x64.dmg`       |
| Windows             | `crescent-*-x64-setup.exe` |
| Linux               | `.AppImage` 或 `.deb`      |

同一 Release 里的 `SHA256SUMS.txt` 可以用来校验下载文件。

## macOS：「已损坏，无法打开」

在仓库配置签名密钥之前，部分正式包可能仍未签名。说明见仓库内 [docs/CODE_SIGNING.md](https://github.com/aide-family/Crescent/blob/main/docs/CODE_SIGNING.md)。

从浏览器下载后，Gatekeeper 可能提示 **「Crescent」已损坏，无法打开**。这不是安装包损坏。把 `Crescent.app` 放进「应用程序」后，解除隔离再打开：

```bash
xattr -cr /Applications/Crescent.app
```

也可以在「系统设置 → 隐私与安全性」里查看是否有「仍要打开」。若仍无法启动，优先使用上面的 `xattr` 命令。

## 从源码安装

开发者克隆仓库后在仓库根目录安装依赖：

```bash
npm install
```

本地运行和打包见 [从源码运行与贡献](/develop/)。
