# 从源码启动与构建

## 环境要求

- Node.js 22.19 或更高版本
- npm（随 Node.js 安装）
- 首次安装依赖时需要网络连接

## 开发模式

解压源码后，在项目根目录运行：

```bash
npm ci
npm run dev
```

`npm ci` 会按 `package-lock.json` 安装依赖并准备 Electron 原生模块。之后每次开发启动运行 `npm run dev` 即可。应用可以启动和浏览；要使用 AI Agent，还需要在应用设置中配置模型供应商和 API 凭据。

## 编译和桌面安装包

```bash
# 编译主进程和渲染进程，输出到 out/
npm run build

# 按目标平台生成桌面安装包
npm run build:mac
npm run build:win
npm run build:linux
```

桌面安装包输出到 `dist/`。通常应在目标操作系统上构建对应平台的安装包。macOS 正式签名与公证需要配置 Apple 证书；本地无签名构建可运行 `npm run build:mac:unsigned`。

## 常见问题

- 如果 `npm ci` 失败，检查 Node.js 版本和网络，然后重新运行 `npm ci`。
- Windows 首次安装可能需要允许原生依赖安装脚本运行。
- 应用配置和用户数据保存在系统用户目录，不包含在源码压缩包中。
