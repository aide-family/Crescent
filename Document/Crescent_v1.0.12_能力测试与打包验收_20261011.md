# Crescent v1.0.12 能力测试与 macOS 打包验收

日期：2026-10-11。工作区：`/Users/xusong.yu/Desktop/Crescent-test`。本次按用户追加要求，对数字员工改动完成能力测试后制作本地 Universal 包。保持已有工作区修改，不提交、push 或发布。

## 功能验证

完整 CI 包含 lint、298 项安全边界静态检查、Node/Web 类型检查和构建。最终本地 Vitest 为 **33 个测试文件、192 项测试全部通过**；测试文件保持 gitignored。

真实 Electron / typed preload / trusted IPC / main / SQLite / Tree-sitter / Pi SDK / 原生 PTY 流程共 **20 个场景通过**：

| 能力           | 实际验证                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 代码索引       | TS、TSX、JS、Python、Shell、YAML、JSON；符号定义与引用位置；正向依赖、反向影响；排除依赖、敏感文件和越界目录；删除文件后更新；清空索引     |
| Agent 工具     | 实际 Pi 调用 code_search、symbol_lookup、dependency_trace、impact_analysis、memory_search、read、bash；原生 PTY 执行隔离的只读 printf 标记 |
| 计划模式       | 五个知识工具及 read/bash 可用；edit/write 不进入 allowlist                                                                                 |
| 手动整理       | UI 取消授权不发送；确认后发送脱敏历史；只生成候选；不同模型需要独立授权；未变化历史不重复调用                                              |
| 审核与召回     | UI 确认候选后显示已学习；问题前实际注入记忆；跨连接内容不进入本地召回；关闭召回及归档后不再注入相关内容                                    |
| 知识管理       | 关系新增/删除；条目删除；清空知识不清除原历史                                                                                              |
| 批量与自动整理 | UI 批量处理待整理历史；真实后台定时器在会话空闲后生成候选，仍需审核                                                                        |
| 中断与失败     | IPC 取消不保存候选或完成标记；非法模型 JSON 不标记已学习；分段失败、历史修订变化、清空期间的请求不会提交半成品                             |
| 持久化         | 实际退出并重新启动 Electron，知识、授权和索引仍保留；撤销授权后阻止新历史发送                                                              |

模型部分使用受控的回环 HTTP/SSE 接口，走真实 Pi SDK，数据为合成对话；**没有向生产模型发送用户原有历史，也没有对生产集群实施操作**。这证明产品与传输流程，不证明真实 LLM 的知识提炼质量。

## 真实仓库与测试发现的修复

Crescent 工作区实际索引 **448 个文件、28594 个符号**，未触发索引容量上限；定位到 `runPiAgent`（pi-host.ts）与 `createPtyBashToolDefinition`（pi-terminal-bash.ts），并追踪 Host、模型、工具及终端相关静态导入。

完整测试发现并修复：

1. 原来先脱敏再做 AST 解析，脱敏会破坏部分表达式结构，导致 46 个额外语法告警。改为 main 在授权范围内读取原文并解析 AST，只保存脱敏文本与受限符号信息；普通 read/IPC 保持默认脱敏，请求 payload 无法打开内部原文选项。调用引用仅保留 callable identity，不收集参数值或匿名函数正文。
2. 为缓存文件持久化 `parse_error`，修复再次索引时告警计数被清零的问题；缓存哈希采用 ast-v2 前缀，旧缓存会重新解析。
3. `tree-sitter-wasms 0.1.13` 元数据包含自身依赖，electron-builder 的节点复制阶段会耗尽内存。同一实际依赖图复现：保留自身引用时 512 MiB 限制下失败，移除后正常收集 455 个模块。锁定不含自身依赖的 **0.1.11**，与 web-tree-sitter 0.20.8 配套，六种语言解析回归通过，并加入防回归检查。

修复后真实仓库语法告警从 **47 降至 1**。剩余 `src/renderer/src/components/markdown/MermaidBlock.tsx` 的语法兼容告警不影响应用构建，但该文件的 AST 结果不能视为完整。依赖图仍描述静态导入和词法证据，不证明动态调用或 Electron IPC 的运行链；需要 read 核对两端。

## 构建输入与方式

版本已更新为 1.0.12。打包采用隔离源码快照 `/tmp/crescent-evolution-packaging.7bYB8l`，540 个输入文件保存 SHA-256 清单；打包期间不修改输入或重建其 out 目录。项目 node_modules 使用已安装的锁定依赖，原生缓存按 lockfile SRI 校验。

标准入口：

```sh
CRESCENT_OFFLINE_BUILD=1 CRESCENT_LOCAL_BUILD_DIR=dist/local-20261011-evolution npm run build:mac:local
```

入口重新执行完整 CI、本地测试，串行构建、Universal 合并、DMG/ZIP。保留 native unpack、mergeASARs: false、精确 x64ArchFiles；关闭签名、公证与发布。不以提高 Node 内存上限绕过自身依赖缺陷。

## 产物验收

最终产物已复制到 `dist/local-20261011-evolution/universal/`，只交付一套 Universal 应用：

- `mac-universal/Crescent.app`
- `crescent-1.0.12-universal.dmg`（约 334 MiB）
- `Crescent-1.0.12-universal-mac.zip`（约 337 MiB）
- `SHA256SUMS.txt`

最终标准打包入口退出码 0；`hdiutil verify` 确认 DMG checksum VALID，`unzip -tq` 无错误，项目 smoke:packaging 检查通过。

从实际打包应用重新跑完全部 20 个场景，`app.isPackaged=true`、版本 1.0.12。严格验证了原生终端 mode=pty、独立行上的 printf 标记以及各工具的结构化结果；开发目录不作为运行工作目录。再次验证真实仓库 448 文件、28594 符号和 1 个已知语法告警。

主程序、Electron Framework、通用 esbuild 均通过 `lipo -archs` 确认 `x86_64 arm64`；node-pty 的 pty.node/spawn-helper 和 Pi TUI darwin-platform.node 两架构预编译文件均在包内。8 个 Tree-sitter 核心/语言 WASM 文件齐全。包内 287 个编译资源逐项与冻结构建输出比较一致；没有 src、用户测试、experiments、Document、out/implementation、.env、.npmrc、memory.db 或 code_index.db 等工作区/用户数据路径。

最终 `app.asar` SHA-256：`35bfcb47e099434f0ae03463bbdc70deecbc254c7930eb4a76e59e572eb37a96`。复制到交付目录后再次核对一致；540 个冻结输入没有变化。

| 文件                              | SHA-256                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| crescent-1.0.12-universal.dmg     | eaaf1478f9a4fc9662724a1bce6e5019e66308b304cf40522056c12c406725d4 |
| Crescent-1.0.12-universal-mac.zip | 79206166135ed3c6f4bf6308d3d7395a58a7804368cacf64326abd4e7fadd399 |

本机为 Intel x86_64。Apple Silicon 部分须区分静态架构证明与真机运行；未签名本地包不代表已完成正式分发签名、公证或 Gatekeeper 验收。

机器可读证据与本地测试脚本位于 `out/implementation/evolution-20261011/`（gitignored，且被安装包排除）。
