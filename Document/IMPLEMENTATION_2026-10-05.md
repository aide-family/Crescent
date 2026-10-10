# Crescent 本地改造与验证记录

执行范围来自「Pi Agent Release Watch」实施计划，2026-10-05 开始，2026-10-06 继续验证和打包。修改保留在 `/Users/xusong.yu/Desktop/Crescent-test`；未 commit、push 或创建 PR。保留已有安全加固、主题、图标、Document 目录迁移及 Universal 原生依赖配置。

## 已落地

| 领域     | 变更                                                                                                                                 | 验证                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 项目指令 | AGENTS 第 9 行仅引用实际存在的 pi-dev / electron-development；规则文件同步清理无效技能引用                                           | 检查技能文件和项目规则                                                                                     |
| Renderer | 1.5 MiB 警告、2 MiB 硬限制；Settings / History / Wiki / Skills / MCP / Whale 按需分包；修复 App 与 UI 的循环 chunk                   | 生产构建，无循环 chunk 警告；真实 UI 打开/关闭各面板                                                       |
| Whale    | 启动时关闭；点击后挂载、逐动作导入视频 URL；关闭时卸载视频和资源回调                                                                 | 启动 0 视频请求，点击后 1 个视频请求并解码，关闭后 0 video 元素                                            |
| Pi       | 三包统一官方 1.0.3，移除旧安全重打包；依赖锁和文档更新                                                                               | 干净 npm ci、产品 audit 0；真实 SDK 流式输出、Host 工具、steering、压缩、释放测试                          |
| Runtime  | Host 会话/模型/事件/工具协议；Pi 主会话与子 Agent 使用适配器；私有 ESM 路径集中在 loader                                             | 类型检查、本地 SDK 夹具、打包应用中实际 Pi 加载和调用                                                      |
| App      | 提取 Agent / Provider / Wiki / History / Skills / Capture / Password / Feedback / Layout / Persistence 控制器；typed preload clients | App 约 9111 → 6245 行；完整类型、测试与 UI 门禁。低于 6000 行仍是后续软目标                                |
| 大组件   | Timeline 拆分为命令、消息、工具、连接、结果操作和审批视图；Markdown 拆分解析、Mermaid、代码块和 SVG 导出                             | Timeline 489 行、Markdown 58 行；现有 SVG 消毒边界保留                                                     |
| Preload  | app / agent / terminal / connections / storage / update / whaleMonitor 模块；index 仅 contextBridge                                  | 拆分时 155 个固定 IPC channel 使用点保持一致；不提供 contextIsolation 关闭时的 fallback                    |
| Terminal | 会话 manager、PTY/PIPE factory、输出合并；停止时通知等待者；旧会话事件不能完成新会话                                                 | 本地生命周期测试；实际 PTY 输入、完成和输出；退出释放验证                                                  |
| 命令策略 | shell wrapper / kubectl / Docker / SSH / sudo / systemctl / 参数检查分模块                                                           | 与拆分前 7920 次对照一致，安全门禁通过                                                                     |
| SQLite   | Row Schema / Mapper 校验字段、状态枚举、计数；兼容可空历史列并跳过损坏记录                                                           | 本地损坏字段、枚举、nullable 和邻近记录测试                                                                |
| Thinking | off / low / medium / high / max，默认 high；非推理模型 off；可选 per-model 采样映射，仅允许有界参数                                  | UI 持久化实测；非法采样/凭据字段剔除测试；模型列表编辑保留采样映射                                         |
| 实验能力 | tool_search / QuickJS codemode 仅隔离验证；生产 noExtensions 和工具 allowlist 保留                                                   | 发现工具不执行；嵌套调用保留 Host 拒绝；沙箱无 process / require / fetch；未授权 bash 不可调用；死循环超时 |
| 备选 SDK | OpenAI Agents 0.18.0 / Cline Agents 0.0.90 隔离适配器、Host 串行队列和基准                                                           | 两个实际 SDK 共 24 个夹具场景通过；没有接入产品默认 Runtime                                                |
| 启动观测 | Main / Pi 资源 / 提示调用 trace；Renderer boot / first UI / first terminal Performance marks；独立数据目录和 Electron profile        | 实际运行采集；测试数据与用户常规数据隔离                                                                   |
| 发布链路 | verify:local；本地无签名三架构入口；Release 增加独立质量门、审计和 Universal matrix                                                  | 本地门禁通过；未执行远程 GitHub Actions 或发布                                                             |
| 原生打包 | 保留 node-pty / Pi / MCP / photon unpack；native hook 优先 npm cache 且验证 lockfile SRI；排除实验图谱与 out/implementation          | 三架构构建及安装包检查记录见下方交付证据                                                                   |

## 门禁与运行证据

- 初始 CI：242 项安全边界检查、Node/Web 类型检查、生产构建通过；lint 有 2 条格式警告。本地 7 文件 / 59 测试。
- 最终 `npm run verify:local`：lint 0 error / 0 warning，275 项静态安全检查，Node/Web 类型检查，生产构建通过；11 文件 / 73 项本地测试通过。测试继续留在本地，不进入仓库。
- `npm audit`：产品依赖 0 漏洞。http-cache-semantics 升级到 4.3.0，官方 Pi shrinkwrap 使用已修复的 brace-expansion。
- 首屏核心 UI chunk 约 1306 kB（未压缩），比原先 App + UI 两个 chunk 的总量小；现在包含更多控制器代码，不能把单个 chunk 前后变化误读为总加载体积。可选面板形成 10–56 kB 独立 chunk；Whale 视频资源总量仍随安装包交付，延迟加载降低启动请求和解码开销。
- x64 已打包 `.app` 在当前 Intel macOS 实际启动，0 Renderer pageerror。设置推理强度真实持久化；延迟面板、Whale、真实 PTY 输入/输出通过。
- 同一打包应用使用本地 OpenAI 兼容 SSE 夹具调用真实 Pi / Crescent Host bash：只读命令可完成，写命令触发一次审批并拒绝，目标目录未创建。生产工具列表不包含 codemode / tool_search。
- 一次打包应用采样：Renderer start 约 479 ms，first UI 约 1277 ms，first terminal ready 约 1370 ms（相对该 Renderer navigation）。这不是多次平均或性能承诺。

## SDK 评估与验收边界

OpenAI / Cline 的 24 个场景覆盖 readonly、批准/拒绝写、审批后目标漂移、SSH 不可用、超时、取消、模拟 MCP / subagent、串行调用、未知命令、transcript 恢复。使用实际 SDK 循环，但 Host 决策与外部传输为固定夹具。OpenAI 即使设置 parallelToolCalls=false 仍可能并行执行已收到调用，因此串行化必须放在 Host。

已按用户确认复用现有 OpenAI 环境凭据尝试真实 Responses 和 Chat Completions；配置端点出现传输失败。独立只读连接检查返回 UND_ERR_SOCKET，没有完成真实模型工具调用验收；凭据仅通过环境变量供调用使用，未输出 Key 内容。可用实验入口在连通后复现，不把夹具结果视为真实模型性能或成本比较。

Cline 实验依赖最初 20 个漏洞报告，定向 overrides 后（尚未验证所有供应商）剩余 13 个高危条目，均来自 node-forge / SAP 供应商链路；未发现可直接升级的安全版本。整个实验目录与依赖不进入产品。继续以 Pi 为默认；OpenAI 会话 steering / compaction、真实 SSH / MCP / 子终端集成仍需单独 PoC 验收，Cline 暂不进入生产候选。

本次没有真实 SSH / Kubernetes 环境操作。arm64 应用在当前 Intel 主机只做结构和架构验证；不宣称 Apple Silicon 设备验收。宏观结构拆分已经落地，App 仍有组合与会话控制职责，未为行数目标做一次性重写。

## 交付证据

本地命令：`npm run build:mac:local`，按 x64 / arm64 / Universal 输出到 `dist/local-20261005/`。本地流程明确禁用签名身份、hardenedRuntime、公证和发布；不需要开发者证书。现有签名发布流程独立保留。

三种架构的 `.app` / `.dmg` / `.zip` 已生成：

| 架构      | 安装包                                                                                   | 运行验收                                                                                            |
| --------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| x64       | `x64/crescent-1.0.11-x64.dmg`、`x64/Crescent-1.0.11-mac.zip`                             | 当前 Intel 主机：UI、Whale、真实 PTY、Pi + 本地模型夹具、审批拒绝                                   |
| arm64     | `arm64/crescent-1.0.11-arm64.dmg`、`arm64/Crescent-1.0.11-arm64-mac.zip`                 | 结构与架构检查；未做 Apple Silicon 设备验收                                                         |
| Universal | `universal/crescent-1.0.11-universal.dmg`、`universal/Crescent-1.0.11-universal-mac.zip` | 当前 Intel 主机：与 x64 相同的工作流；sandbox / contextIsolation / nodeIntegration 实际配置检查通过 |

- 三个 DMG 均通过 `hdiutil verify`，三个 ZIP 均通过 `unzip -tq`。
- 两种独立架构和 Universal 的 ASAR SHA-256 相同。Universal 主执行文件、Electron Framework、esbuild 为 x86_64 + arm64；两套 node-pty / pi-tui 原生 prebuild 均保留且各自架构正确。
- 应用无 Developer ID 签名且未公证；未将实验 SDK、实验 node_modules、源项目测试、缓存、日志、备份或 .cursor / .git 打进应用。第三方 npm 包按生产依赖交付。
- 校验清单位于 `dist/local-20261005/SHA256SUMS.txt`，详细结构记录为 `out/implementation/macos-artifacts.json`。
- Universal 首次复用含 x64 加密测试凭据的数据目录时，在读取配置阶段出现启动超时；换独立空数据/profile 后全部流程通过。疑似涉及 macOS Keychain 授权，但未观察原生授权界面确认。保留 safeStorage 策略；跨无签名构建访问旧加密凭据仍需操作员实机确认，不能据新 profile 的成功宣称凭据迁移验收。

详细日志、JSON 基准、截图、改造前快照与旧 Pi 归档备份都在 gitignored `out/implementation/`。实验说明见 [Runtime 评估](../experiments/agent-runtime/README.md)。
