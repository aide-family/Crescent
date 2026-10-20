# Crescent v1.0.11 专项改造：本地实施与验收记录

任务书：[专项改造计划](Crescent_v1.0.11_专项改造计划_20261010.md)。本轮遵循用户的实施指令，按阶段 A～H 完成应用改造；任务书中早期“只审查”字样以本轮用户指令为准。

基线 HEAD：`6888aa766b5951c6d4da201218c21cc09bee69f3`。开始时只有任务书未跟踪。本轮从 2026-10-10 持续实施至 2026-10-11（Asia/Shanghai）；文件名沿用任务书日期。本轮不 commit、不 push、不创建 PR、不发布，不访问生产 SSH、跳板机或集群。运行文件、测试和截图留在 gitignored 的 `out/`、`dist/` 与 `*.test.ts(x)`；未在交付文档保存密码、Token 或生产终端原始日志。

## 已核实的规则与 SDK

- 实际 `AGENTS.md` 与 `.cursor/rules/{architecture-first,development-standards,ci-before-commit,git-commit-author}.mdc` 均存在、已读。
- 实际 `.cursor/skills/pi-dev/SKILL.md` 与 `.cursor/skills/electron-development/SKILL.md` 可用、已读；未使用 EGG、Pi 项目 extensions 或第三方 subagents 产品平面。
- 已安装 `@earendil-works/pi-{coding-agent,agent-core,ai}` 均为 1.0.3。读取 `docs/sdk.md`、`docs/security.md`、`docs/extensions.md`，以及 SDK、read/edit/write、ToolDefinition、truncate、withFileMutationQueue 类型。
- Pi 工具允许列表替代默认列表；所有主机工具显式登记。Pi ESM 入口仍集中在 `pi-sdk.ts`/runtime loader；敏感文件、审批、SSH、PTY 和持久化由主进程持有。
- 安全审核、模板标签、模型判断与 MCP annotations 均不能提供写操作自动批准。

## 阶段与修改清单

| 阶段              | 主要文件/模块                                                                                                                                        | 设计与验收                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A：基线           | `pending-command.test.ts`、`MessageRows.test.tsx`，其余本地故障夹具                                                                                  | 修改核心代码前，6 项夹具中 4 项红：8s 自动中断、续行误中断、结束未知发中断、完成思考默认展开。SSH 降级、永久指纹、Handoff local 等其余根因先由实际调用链确认，再补行为回归。                                                                                                                                                                                                                                                             |
| B：终端协议       | `terminal/{pending-command,ipc,script-runner,output-format}.ts`；`command-outcome.ts`、`command-timeouts.ts`；terminal preload                       | 传输、启动、空闲、业务运行、审批计时分离。每个 Base64 输入块有独立随机 ACK，订阅先于 write，完整 ACK 输出行才放行下一块；变量内存解码，不落临时远端脚本，不改 stty。传输时间不消耗业务执行预算。ACK 缺失停止后续输入、标记未知，不发 Ctrl+C、不降级 SSH。                                                                                                                                                                                |
| C：失败与路由     | `agent/{command-failures,pi-terminal-bash,pi-open-subterminal}.ts`；tool catalog、ExecutionTargetChip                                                | 精确命令摘要结合 pane/窗口/连接/代次/cwd 身份；不再将规范化通配串放进永久失败集合。只读失败循环 3 次/30 秒软刹车；普通超时可在状态确认后重试。已派发未知命令的 pane 被隔离，收到结束标记或人工中断后新鲜 prompt 才释放；不能换拼写重放变更。local 临时路由栈一次 bash 后恢复，恢复核实完整身份；新增 return_to_main_terminal 与 UI 回主终端。                                                                                            |
| D：计划与审批     | `approval-policy.ts`、`command-approval.ts`、`change-plan.ts`、`pi-change-plan.ts`、`pi-local-files.ts`、`ChangePlanReview.tsx`、AgentPanel/Settings | 保留原 host 计划执行器。增加当前 run/目标、10 分钟有效的 safe-auto 授权；默认 routine 只读检查可自动，提权检查需有效授权；写、未知、敏感读取、跨主机/外部网络命令均人工确认。审核失败关闭执行。新增仅人工执行偏好；扩大 SSH 登录范围逐次人工确认，配置/父目标变化会撤销批准，safe-auto 不绕过此门禁。Pi edit/write 同样审核，文件/运行变化撤销批准。编辑计划撤销旧 digest，重新 preflight 与审批；恢复仍须单独明确授权，未知完成不恢复。 |
| E：Handoff        | `handoff.ts`、`handoff-target.ts`、useHandoff、HandoffDialog、App、terminal IPC、SQLite/rows                                                         | 可选沿用、保存连接、本机、仅资料；从当前共享会话的持久主终端继承，排除临时 local 子窗格。沿用 SSH 创建独立终端并复用已有启动队列，未 ready 禁止执行。主进程保存目标意图，阻止 local fallback；不复制登录凭据、子终端 ID、审批令牌。执行偏好继承，批准重新取得。仅资料/待验证标志、期望目标与连接来源有 SQLite 迁移；主进程在 PTY 启动前重建持久执行意图，恢复也不能落到本机。                                                            |
| F：思考与命令手册 | `MessageRows.tsx`、AgentRunTimeline、agent-style、run-document/trace；command-directory shared/main/preload；CommandDirectorySheet                   | 默认隐藏思考正文，流式显示可选；段结束/run 结束/会话重建后重新收起，完成摘要不露内容预览。默认持久化与报告剔除原始 reasoning。新增独立手册抽屉：分类、全局/连接/集群 ID 范围、字段编辑、参数类型、收藏、搜索、排序/置顶、复制到另一范围、JSON/Markdown 导入导出、revision 与撤销。复制/插入/解释/审查执行分开；主进程渲染并绑定目标、重审风险。                                                                                          |
| G：本地资料       | `local-document-reader.ts`、local-document IPC/shared/preload；LocalDocumentsSheet、LocalPdfPreview；Pi local files                                  | 工作区与用户选择的窗口授权路径；原文件选择器、粘贴附件和资料抽屉共享授权。规范化路径并复核符号链接、文件类型、大小与 inode；跨行私钥内容在范围读取中也保持脱敏。UTF-8/UTF-16、行号、范围/关键词、取消、限制树列表；本机读取不切换 bash 目标。PDF.js 6.4.299 独立 worker 和懒加载 chunk，逐页预览、引用；无云转码/OCR。可选 MCP 继续通过现有管理器显式配置，不自动安装或挂载家目录。                                                      |
| H：检查/打包      | `electron.vite.config.ts`、`electron-builder.yml`、`scripts/{build-macos-local,prepare-macos-native}.cjs`；本地运行夹具                              | 保留 2 MiB renderer 门禁与所有 native unpack 规则；新文档/手册/PDF 按需加载，native canvas 不进入运行包。离线缓存预检查，esbuild tarball 按 lock SRI 验证，离线缺缓存直接失败。构建输入与打包串行，禁止发布、签名与公证。                                                                                                                                                                                                                |

### B/C 的状态约束

`blocked-before-dispatch`、`timeout-unconfirmed`、`completion-unknown`、`user-cancelled`、`session-exited`、`confirmed-exit-nonzero` 与 `completed` 独立。未知完成不会伪造退出码。空输出且退出 0 保留成功语义，不能凭“输出为空”断言业务失败。

用户可以在设置调整启动/空闲/执行/审批预算；主进程限幅，执行偏好通常 120 秒，可设 60～600 秒。运行中“继续等待 +120s”是一次显式延长，不由模型无限续期。仅用户 Ctrl+C、停止或 run Abort 发送中断。

## 本地自动化证据

最终检查命令：

```sh
npm run ci
npm run test:local
git diff --check
```

检查输出：`out/implementation-ci-20261010.log`、`out/implementation-tests-20261010.log`。`npm run ci` 包含 lint、静态安全策略、node/web typecheck、production build；本地 Vitest 是独立行为覆盖。测试均保持 gitignored。

| 验收场景                                    | 已观察到的结果                                                                                                | 证据级别/入口                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 8 秒后无 start marker                       | 不发 Ctrl+C；身份、SSH ready/alignment 不被命令等待改写                                                       | 假时钟 + 实际 terminal IPC 集成夹具                         |
| ACK 丢失/命令 echo 假 ACK                   | 一次待确认输入，不重放、不发送下一块；原样 echo 不算确认                                                      | script-runner 故障注入                                      |
| 引号、AWK、here-doc、15 KB 长内容、关闭回显 | bash/zsh/sh 的真实隔离 node-pty 捕获正确输出与退出 0                                                          | 本机实际 PTY；zsh 初次失败推动逐行、随后 ACK 协议修复       |
| 2～5 分钟持续输出 + 继续等待                | 不被 10 秒截断；延长有明确预算，完成后计时器清理                                                              | 假时钟 300s 行为测试                                        |
| 结束 marker 丢失                            | 结果未知、退出码不可信、无自动中断；下一命令注入被阻断                                                        | pending controller + terminal IPC                           |
| 只读失败重试                                | 单次 timeout 可重试；短循环受限，30 秒后解除；不同窗口/目标/代次/cwd/资源隔离                                 | command-failures、pi-target-routing                         |
| 同 pane 与并行 pane                         | 同 pane 保持互斥，另一个 pane 独立；旧代次输出/退出不能改新会话                                               | lifecycle-integration、manager                              |
| local 资料与 SSH parent                     | read 不切换目标；临时 local bash 后恢复；parent 更换/不健康则阻断                                             | 使用真实 Pi read + 路由测试                                 |
| 手动 SSH/多跳                               | 连接来源独立；本轮固定身份不容许退回本机后继续执行                                                            | 主机路由/状态回归；另有真实回环单跳/双跳传输                |
| 思考与正文                                  | 完成默认不展开、不显示内容预览；正文保留；历史/trace 默认不含 raw reasoning                                   | SSR、history/trace 回归                                     |
| 计划流程                                    | mock 调查→preflight→用户批准→变更→验收；拒绝、编辑、错 owner/digest、目标变化、取消、未知完成、恢复授权均验证 | 保留 host executor 的 change-plan 测试；无真实写操作        |
| safe-auto 与本地写                          | 确定性规则 + 当前目标授权；所有实际写仍弹审批；计划/仅人工模式不能调用 Pi write/edit 修改文件                 | approval-policy、真实 Pi file tool 测试                     |
| 手册执行                                    | 完整命令与目标预览后主机重审；实际本机 hostname 成功；变更夹具拒绝后无文件生成                                | 隔离 Electron UI/main 真运行                                |
| Handoff SSH 与不同目标                      | 保存目标、重新建链；新会话未 ready 不派发；共享聊天 peer/local 子窗格继承持久 parent                          | shared handoff、renderer parent 与 actual terminal IPC 回归 |
| 超大文件/二进制/符号链接/敏感路径           | 限制、拒绝、取消与可解释错误；不读取授权根以外路径                                                            | LocalDocumentReader 测试                                    |
| 文档/PDF                                    | 路径授权、行号引用、PDF worker 逐页渲染通过                                                                   | `out/implementation/runtime-20261010/evidence.json` 与截图  |
| 非 POSIX shell 边界                         | 自动 sentinel 执行阻断，提示使用配置的 bash/sh 或人工执行；不会丢失目标/审批边界                              | 通用拒绝保护；Windows 不适配、不列入本轮验收                |

回环 SSH 证据：`out/implementation/loopback-evidence.json`。临时 sshd 仅监听 `127.0.0.1`，临时生成 host/client key，严格检查临时 known_hosts；分别走一跳与 SSH 转发双跳，执行 `hostname` 并确认 PTY 标记。测试结束停止 sshd、移除临时 key/config。它证明真实 SSH 传输协议，不证明生产主机身份/复杂跳板现场兼容性。

UI 截图（仅隔离夹具，无生产内容）：

- [命令手册](../out/implementation/runtime-20261010/command-directory.png)
- [完整命令预览](../out/implementation/runtime-20261010/command-preview.png)
- [本地文本资料](../out/implementation/runtime-20261010/local-documents.png)
- [本地 PDF](../out/implementation/runtime-20261010/local-pdf.png)

## 回归中发现并处理的失败

1. 原始 8s/续行 watchdog 注入中断与完成思考展开：先红后绿。
2. 任意块跨多个 zsh accept-line 周期会丢输入：本机真实测试发现，改为物理行限幅，再加入每块 ACK；不以延长时间替代协议修复。
3. PDF 首版被自动合入 renderer-ui 触发 2 MiB 门禁：增加独立懒加载边界，保留门禁。
4. 首次空会话不出现在有记录的历史列表：修正运行夹具取实际 session metadata，不修改历史产品语义。
5. 运行夹具强制 app.exit 可产生 native 回调销毁竞态：改为正常 app.quit，正常退出验证通过；不把强制退出错误当业务回归。
6. 初轮打包与 out 重建并行，Universal 报旧 chunk ENOENT：停止并行、冻结输入、最终串行重打；初轮产物不作为最终验收证据。

## 剩余限制、风险与回滚

- 真实生产、企业跳板链、不同 prompt/custom shell、真实集群版本，以及 Apple Silicon 实机尚未验收；按用户后续要求，Windows 适配与验收不在本轮范围。本轮禁止生产连接；回环 SSH 和 mock 不能替代这些验收。
- 非 POSIX shell 不尝试注入 POSIX wrapper。需要配置可用 bash/sh 或手工执行，保留拒绝边界。
- 文本上限 20 MiB、单片 50 KB/500 行、树列表 200 项；PDF 上限 2 MiB/200 页与页面像素限制。PDF 文本提取无需外部服务；加密文档、超大 PDF、图片 OCR 与 Office 转换器保留显式配置/人工处理。
- 计划 DSL 保留原支持范围（受约束文件备份/复制、systemctl 与精确 kubectl scale）。任意脚本、不可逆操作等需要逐命令人工审核或人工执行。修改草案会要求新的审批。
- 手册集群范围使用稳定 ID，与连接 ID 绑定；不从 hostname 自动推断多个连接属于同一集群。撤销保留一份上一 revision，不是无限版本库。
- `npm audit --omit=dev` 发现原有依赖 1 critical、1 high、2 low。`proxy-addr@2.0.7` 的 IPv4-mapped IPv6 信任子网告警，以及 `@modelcontextprotocol/sdk@1.30.0` 的 OAuth 授权服务器选择告警，在基线锁文件已存在；PDF.js 没引入这两项。具体产品路径可达性尚未建立，不将包级严重性等同已发生利用。生产发布前应单独升级并回归 MCP/网络依赖；本轮未自动改动 Pi/MCP 依赖体系。
- 本地 Mac 包未签名、未公证；Gatekeeper 与 arm64 硬件运行不在静态包验证结论内。
- 回滚：按本报告的模块清单从基线恢复对应源码/config；保留新的 `command-directory.json` 与上一 revision、SQLite 和应用设置备份。SQLite 新列可以保留，旧程序忽略；不要删除用户数据或用旧配置覆盖现有加密凭据。测试/输出目录均不进入 Git 交付。

## 离线 Mac 打包方案

只在可信联网准备机安装锁定依赖、完成 postinstall，并预热 Electron 41.10.7 两架构 ZIP、electron-builder DMG 工具、锁定 esbuild Darwin tarball。携带源码与 lockfile、可用 node_modules/native prebuilds、缓存；不得携带个人配置、密码、Token、生产日志或私钥。

离线机使用相同 Node/依赖与缓存，先完整检查，再构建：

```sh
npm run verify:local
CRESCENT_OFFLINE_BUILD=1 npm run build:mac:local
```

2026-10-11 用户补充要求已成为后续开发规则：所有 Mac 打包入口统一生成 **Universal**，同一 `.app`、DMG、ZIP 均包含 x64 + arm64；不再默认生成独立架构包，不开展 Windows 适配。旧 `:x64` / `:arm64` 名称保留为 Universal 兼容别名。输出默认 `dist/local-macos/universal/`；可用 `CRESCENT_LOCAL_BUILD_DIR` 指定 dist 内的独立目录。脚本显式 `--publish never`，剔除继承的签名/Apple 环境凭据，关闭本地 signing/notarization；普通签名发布入口保持独立。缓存不足直接失败，不默默下载 esbuild。Universal 仍保留 `asarUnpack`、`mergeASARs: false` 与精确 native 架构规则。

运行应用可使用 `CRESCENT_DATA_DIR` 与 `CRESCENT_USER_DATA_DIR` 隔离资料和 Electron profile。正常运行保持默认目录。正式分发的签名、公证、证书、Gatekeeper 和目标硬件测试须另行完成，不能以本地 unsigned 包替代。

最终检查数量、包完整性与 SHA-256 记录在下面的最终验证补充中。

### 最终检查补充（应用代码冻结后）

- `npm run ci`：通过；lint 无错误/警告，安全边界策略 **286** 项通过，Node/Web 类型及 production build 通过。
- `npm run test:local`：**26 个文件、153 项测试全部通过**。包括真实 Pi 文件工具、备份 checksum 篡改阻断、跨窗口路由隔离、父目标失效后的执行栅栏、重启恢复执行意图、SSH 新登录范围人工确认、手动 SSH 旧卡片 ID 继承阻断、分片跨行私钥脱敏。
- `git diff --check`：通过；Git 跟踪测试文件数量为 0；HEAD 保持基线，未提交或推送。
- renderer-ui 约 1.323 MB；LocalPdfPreview 约 857 KB；新可选界面与 PDF worker 不在首屏资源清单中。
- 回环 SSH：一跳/双跳均取得 ACK 与 start/end marker，只执行 hostname；临时 daemon/keys 已清理。
- 隔离 Electron：目录授权、文本引用、手册目标预览、主机只读执行、变更拒绝且无文件生成、PDF worker 均通过；正常 app.quit 退出 0。

### 最终 Mac 包验证

串行离线模式构建退出 0，冻结的 61 份应用源码/config/script 文件 SHA-256 全部保持一致。这是用户补充 Universal-only 规则前的三架构历史验收。x64 / Universal 外层应用为 unsigned；arm64 可执行文件仅带 linker ad-hoc 签名（无 TeamIdentifier、无资源封装），不是发行签名。发布、公证与开发者签名身份未启用。以后以 [开发打包规范](DEVELOPMENT.md) 的单一 Universal 产物为准。

| 架构      | 应用/native 完整性                                                     | DMG / ZIP                       | 实际运行                                                               |
| --------- | ---------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| x64       | x86_64 可执行文件；Pi/MCP unpacked；node-pty 与两架构 esbuild 资源齐全 | hdiutil verify / unzip -tq 通过 | 实际 packaged app 的 Pi ModelRuntime、原生 PTY、host hostname 执行通过 |
| arm64     | arm64 可执行文件；unpacked runtime 与两架构 prebuild 齐全              | hdiutil verify / unzip -tq 通过 | 本机 Intel，未作 Apple Silicon 运行承诺                                |
| Universal | x86_64 + arm64 主可执行文件及 esbuild；native prebuild 齐全            | hdiutil verify / unzip -tq 通过 | 两架构静态验证；目标硬件运行仍需后续验收                               |

证据：`out/implementation/macos-verification.json`、`out/implementation/packaged-runtime-evidence.json`、`out/implementation/source-SHA256.json`。产物位于 `dist/local-20261010/{x64,arm64,universal}`；六个 DMG/ZIP 的 SHA-256 在 [SHA256SUMS.txt](../dist/local-20261010/SHA256SUMS.txt)。

最终 69 份源码/config/script/文档及规则变更清单：`out/implementation/deliverable-files.txt`。工作区改动保持本地未提交；测试/运行 profiles/截图/包均在 gitignored 路径。

### 2026-10-11 补充：以后只交付 Universal Mac

用户补充要求已落实到 `package.json`、本地构建脚本、`electron-builder.yml`、发布 workflow、README、签名说明、测试文档及 `.cursor/rules/development-standards.mdc`。所有 Mac 入口统一 Universal，旧 x64/arm64 命令成为兼容别名；发布 workflow 只有一个 Mac Universal 构建行。本轮不做 Windows 适配或验收，也没有触发远程 workflow。持续执行规则和离线方案见 [DEVELOPMENT.md](DEVELOPMENT.md)。

新默认输出根目录 `dist/local-macos/` 实际只有 `universal/`。离线缓存模式构建退出 0；61 份冻结的应用源码/config/script SHA-256 无变化。这里的“离线模式”指显式开启缓存检查及禁用 native 网络回退；没有宣称操作系统层面的断网测试。

- [Universal DMG](../dist/local-macos/universal/crescent-1.0.11-universal.dmg)
- [Universal ZIP](../dist/local-macos/universal/Crescent-1.0.11-universal-mac.zip)
- [SHA256SUMS.txt](../dist/local-macos/SHA256SUMS.txt)

```text
DMG  2a0a09ddb8d21de1a76412d5ec64d916224606f29333d4441ee94dacd2c96c64
ZIP  a846313eec7a247f3ea968d321794b6bfda3d8c0c0971e5892055e5919c2435a
```

`hdiutil verify`、`unzip -tq`、仓库 `smoke:packaging` 均通过。主程序和通用 esbuild 的 `lipo -archs` 均为 `x86_64 arm64`；node-pty、Pi native prebuilds 两架构分别校验通过；Pi/MCP unpacked 路径、PDF lazy chunk 和 worker 完整。外层应用 unsigned，未发布、未公证。

**实际 Universal 应用运行（Intel 本机）**：Pi ModelRuntime 成功加载、原生 PTY 成功启动、host `hostname` 命令已派发并确认完成，renderer 从打包的 app.asar 加载。使用独立空白配置/profile，不访问模型付费接口或生产连接；测试结束清理自有窗口与进程。Apple Silicon 真机运行仍待验证，不能以此 Intel 运行证据替代。

证据：`out/implementation/universal-build-20261011.log`、`universal-verification-20261011.log`、`macos-universal-verification.json`、`packaged-universal-runtime-evidence.json`、`source-universal-SHA256.json`。Universal 规则变更后的完整门禁日志为 `out/implementation/universal-ci-20261011.log`（CI 通过、安全策略 286 项、本地 26 文件 / 153 测试通过）。

发布配置与文档同步后的最后一轮 `npm run verify:local` 也退出 0：CI 全项通过、安全策略 286 项、26 文件 / 153 测试全部通过（`out/implementation/universal-final-ci-20261011.log`）。最终 `git diff --check` 通过，冻结的 61 份应用输入无变化，69 份交付文件保持本地未提交，Git 跟踪测试文件为 0，HEAD 保持上述基线。
