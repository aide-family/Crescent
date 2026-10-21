# Crescent v1.0.11 专项代码审查与改造实施计划（交 Codex）

> 审查时间：2026-10-10  
> 目标项目：`/Users/xusong.yu/Desktop/Crescent-test`  
> 基线：`package.json` 版本 `1.0.11`，Electron + React + TypeScript + Pi Agent  
> 本文用途：实施任务书和验收标准。此轮只审查与出方案，不修改应用代码，不连接生产集群执行测试。

## 0. 结论与任务原则

当前七项反馈不是七个独立 UI 小问题，其中第 1、3、5、7 项共享「Agent 命令执行目标和生命周期」根因。要将命令状态、终端身份、会话路由、审批边界统一在 Electron 主进程实现，Renderer 只负责显示与显式用户操作。

**非协商要求：**

1. 本次优化必须适用于不同公司、集群、域名、跳板机、SSH 层级与 shell；不得硬编码截图中的集群、IP、主机名或环境变量。
2. 不向集群、跳板机、中控机部署组件或修改其配置。插件和本地文档转换器均运行在 Crescent 客户端一侧。
3. 不因启动标记缺失、输出间歇或工具等待超时，直接把 SSH 判为断开，更不能默认对远程 shell 注入 Ctrl+C。
4. 所有变更（包括远程配置修改、服务重启、删除、Kubernetes 写操作、本地文件写入）在默认策略下需要人工确认；若用户要求实际手工执行，Agent 只能生成并展示命令，不得代替执行。
5. 超时后不对**可能已执行的变更命令**自动重放。状态未知须进入只读核验或人工确认。
6. 安全审核与审批必须留在主进程；LLM 解释、UI 颜色、白名单和工具 metadata 不能替代主机端的权限判断。
7. 每阶段补充可重复的单元/集成测试。遵守仓库 `AGENTS.md`、`.cursor/rules/`、`.cursor/skills/pi-dev/` 与 `.cursor/skills/electron-development/`；变更 Pi 主机接口前阅读已安装 Pi 包文档。不提交本地测试文件，不跳过 hook。

## 1. 证据清单：已确认与待验证分开

| 问题              | 代码证据                                                                                                                                                      | 结论                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. Agent 错误超时   | `src/main/terminal/ipc.ts`：启动超时 `8_000`、续行超时 `5_000`；`pending-command.ts`：未见起始 marker 后 `interruptSession()`、随后超时结束                                       | **确认**存在 8 秒启动硬中断逻辑；截图中相同会话人工 `hostname`/复合命令成功，说明至少一类超时并非真实断连。具体是 PTY 写入、shell 续行、echo/marker 检测还是时序竞态，需仪表化复现。 |
| 1. 超时后 SSH 受限   | `terminal/ipc.ts` 的 `markCommandTimeoutDegraded()` 将 `ready=false`、`alignment=unknown`；`timeout-recovery.ts` 需要新鲜 prompt 才恢复                              | **确认**“命令超时”会影响后续 SSH 目标可用性；不能等同于网络断连。                                                                          |
| 1. 复合长命令        | `terminal/script-runner.ts` 使用临时脚本、Base64 分块并在交互 PTY 输入多行；`output-format.ts` 包装开始/结束 marker                                                               | **确认**启动 marker 发生在脚本解码与执行之后。大命令可能使启动计时包含封装/传输/终端解析时间；具体概率待测试。                                                  |
| 2. 思考展示         | `components/timeline/MessageRows.tsx` 的 `ThoughtStepRow`：配置不默认折叠时，已完成且超过 120 字仍以 `<details open>` 展开；`App.tsx` 由 `showAgentThinking`/风格控制                 | **确认**不符合“完成后一定折叠”；需要与流式展示分开控制。                                                                                 |
| 3. 相同命令拦截       | `agent/pi-terminal-bash.ts` 的 `failedFingerprintsByRunId`、`shouldBlockFailedRetry()`，所有“已派发且 `!ok`”结果（包含超时、未知）可能被加入失败集合                                   | **确认**误超时和失败指纹叠加会持续阻断相同命令，且未考虑目标与错误类型。                                                                          |
| 4. 计划模式         | `pi-host.ts` 在 planned 模式只激活 `bash`/`submit_change_plan`；`pi-terminal-bash.ts` 阻断计划外写命令；`pi-change-plan.ts`、`change-plan.ts` 有校验、绑定、审批、执行与恢复              | **确认**计划模式真实存在。但变更 DSL 的支持范围较窄，实际不同集群验收还需完成。                                                                    |
| 4. 自动审批         | `command-classify.ts` 仅产出 `low/high`；`pi-terminal-bash.ts` 低风险直接执行，高风险走 `command-approval.ts`                                                             | **确认**尚无与用户诉求对应的独立、细粒度自动审批策略。当前审核超时 fallback 为 high，不能放宽。                                                       |
| 5. 子终端路由        | `pi-open-subterminal.ts` 在 `rerouteParentBash` 下调用 `updatePtyBashExecutionTabId()`；`pi-terminal-bash.ts` 只在子终端关闭/主终端登录确认等特定情况恢复 parent                    | **确认**正常读取完本地文件不会自动恢复 SSH 主终端；缺少显式切换工具和任务级作用域。                                                                  |
| 5. 本地工具混淆       | `pi-host.ts` 同时启用 Pi 的 `read/edit/write`（本地工作区）与 Crescent 的 `bash`（可为 SSH）                                                                                | **确认**存在双文件系统/双执行目标，需要在模型工具描述、UI 和主进程目标绑定上明确区分。                                                                 |
| 6. 常用指令         | 当前有 `WikiSheet`、Skills、Slash 命令、顶部工具栏，但没有专为“按集群/连接分类、编辑并执行前预览”的运维指令目录                                                                                     | **需求新增**；推荐复用现有知识库、搜索和存储基础设施。                                                                                   |
| 7. Handoff 丢失连接 | `App.tsx` 的 `createHandoffConversation()` 使用 `createTerminalTab({ isSsh: false, agentInput: draft })`，不带原连接、目标选择或执行上下文；`HandoffDialog.tsx` 只展示模型、没有终端目标选择 | **直接根因确认**：交接生成本地新会话。                                                                                           |

上述是静态代码审查与截图对应关系；**尚未**在真实集群完整重放七项场景。不要把待验证的时序原因写成已修复事实。

## 2. 统一设计：运行会话、资料来源、执行目标和操作权限

### 2.1 主进程维护唯一事实源

新增或扩展如下概念：

```ts
type ExecutionTarget = {
  paneId: string;
  parentPaneId?: string;
  kind: 'local' | 'managed-ssh' | 'manual-ssh' | 'special-ssh';
  connectionId?: string;
  targetIdentity?: string;   // 主机/集群范围/跳板链的验证标识
  sessionGeneration: number;
  readiness: 'ready' | 'busy' | 'degraded' | 'unknown' | 'lost';
};

type ToolScope = {
  readSource: 'local-workspace' | 'remote-terminal' | 'attachment';
  executeOn: ExecutionTarget;
  temporaryReturnTo?: ExecutionTarget;
};
```

字段名称可由 Codex 最终选择；但不能再用“当前显示的 tab 标题”“模型刚才说在某台机上”推定权限和执行目标。

主进程需要保证：每条 `commandId` 绑定 `runId`、窗口 owner、paneId、sessionGeneration、connectionId/集群身份、shell、cwd、超时策略和审批策略。命令执行前重新检查绑定；旧事件不能更改新会话结果。连接状态、命令状态、计划步骤和 UI 时间线消费同一套事实。

### 2.2 命令生命周期与连接健康彻底分离

至少区分：`queued` → `dispatching` → `dispatched` → `started` → `running` / `awaiting-input` → `completed`；旁路状态是 `blocked-before-dispatch`、`user-cancelled`、`timeout-unconfirmed`、`completion-unknown`、`session-exited`。

“启动 marker 没收到”只说明封装/终端执行起点未被确认；“结束 marker 没收到”只说明完成未知；“SSH lost”只能由独立的连接退出或可靠断连证据触发。不能把超时强制映射成 SSH lost 或普通 `exitCode=1`。

## 3. 改造 A：执行超时、长命令和 SSH 恢复（问题 1）

**主要文件：** `src/main/terminal/pending-command.ts`、`ipc.ts`、`script-runner.ts`、`output-format.ts`、`timeout-recovery.ts`、`command-interrupt.ts`、`agent/pi-terminal-bash.ts`、终端事件的 preload/shared 类型。

1. 将超时拆为四个独立概念：`dispatch/start timeout`（命令尚未确认启动）、`idle timeout`（长时间无输出或进度）、`execution hard limit`（用户可配置的总时限）和 `approval timeout`（审批等待）。不要混用。
2. `8s` 启动超时改为**告警及状态确认阈值**，不能直接 Ctrl+C；建议普通链路初始 30 秒、慢速多跳可选 60 秒，最终数值需通过 mock PTY 与现场数据校准。执行总时限建议默认 120 秒、按操作可设 60～600 秒，用户在运行中可以“继续等待”，而不自动增加无限时长。实际阈值应存为用户配置且被主进程限幅。
3. 基于 `write queued`、`PTY accepted`、起始 marker、首个业务输出、结束 marker 分段计时。脚本分块传输/排队不应算作业务执行超时。检查 macOS zsh/bash、Linux bash、容器中的 sh、长 Base64、命令回显关闭、终端尺寸、串行写入与多跳延迟。
4. `script-runner.ts` 必须做输入协议测试：多行脚本、单引号/双引号、嵌套 SSH、AWK、YAML、管道、反斜杠、Base64 回显与 PTY 行缓冲。可改为有背压/确认的分块写入或其他不需在远端安装组件的可靠 PTY 传输；禁止为了规避超时直接向远端落未授权脚本或强行重连。
5. 续行 prompt `>`、`quote>` 的检测要排除脚本封装期间的正常中间态；不能只根据缓冲区最后两行就强制 Ctrl+C。
6. 超过告警阈值时显示“启动待确认 / 仍在等待”，提供“继续等待、只读检查 shell、人工中断”。只有用户点击中断、run Abort，或经可靠安全策略确认的硬超时才发中断信号；中断要区分用户与 watchdog，并记录结果未知。
7. 不因为单次命令 `timedOut` 就置 `expectedHost` 的连接 `ready=false`。建立独立、被动、不插队写入的健康观测。需要重新确认时显示“会话待确认”，而非“已断连”；收到新鲜、匹配范围内的 prompt 后恢复。
8. 检测到命令可能已到达远端但结果不明，严禁自动重放变更命令。只读命令可在同一目标身份校验通过后限次重试。

**埋点：** 仅记录 `commandId`、目标 ID 哈希、阶段、耗时、输入字节数、shell 类型、marker 状态、最后进度时间、超时原因、用户是否中断和结果状态；不得记录完整命令中的凭据、Token 或原始文件内容。

## 4. 改造 B：重复命令与失败追踪（问题 3）

**主要文件：** `src/main/agent/pi-terminal-bash.ts`、`shared/command-guard.ts`、`main/agent/change-plan.ts`、结果类型/时间线。

1. 不再使用“归一化命令字符串在本轮失败过一次”作为通用硬阻断条件。将失败记录键至少扩展为 `命令语义/目标身份/会话代次/cwd/错误类别`。
2. 区分：`confirmed-exit-nonzero`、`blocked-before-dispatch`、`timeout-unconfirmed`、`interrupted`、`SSH_TARGET_UNAVAILABLE`、`approval-denied`、`business-result-empty`。未派发和完成未知不得写成“已执行失败”。
3. 只读查询允许同一命令在目标变化、数据变化、排障阶段变化后合理重试；对短时间无新证据的死循环设置软提示与合理次数限制，而非本轮永久禁用。
4. 已确认失败的相同写命令默认阻止无条件自动重试，但允许 Agent 解释原因、提新的修正计划，并在人工确认后重试；必要时提供“按当前完整目标人工重新运行”按钮。
5. 已派发且结果未知的变更命令需要先只读检查目标现状、幂等性与操作效果；核验不足则人工处理，不能仅换一个命令字符串绕过阻断。
6. 模型收到结构化失败结果：错误类别、是否派发、exitCode 是否可信、是否可安全重复、可用的下一步，不要仅收到“禁止重复命令”的长文案。

## 5. 改造 C：思考过程展示（问题 2）

**主要文件：** `components/timeline/MessageRows.tsx`、`AgentRunTimeline.tsx`、`AgentLogContent.tsx`、`hooks/useAgentRuns.ts`、`App.tsx`、设置字段及语言包。

1. 默认隐藏 reasoning/thinking，用户可在设置里选择“总是隐藏 / 运行时显示”；可加单次会话的“显示思考”按钮。不把思考内容混入正文 `message` 或正式结果。
2. 运行过程中若用户启用，可以流式展示；**一旦 run 或该思考段结束，自动完全折叠**，仅保留简洁一行“思考过程 · 已完成”，用户点击后才展开历史内容。
3. `ThoughtStepRow` 不可再依赖 `collapsedByDefault=false` 时 `<details open>` 的非受控默认；用稳定 `runId + thoughtStepId` 和阶段驱动的受控展开状态，结束/切换会话/恢复历史均收起。
4. 工具调用、审批、用户操作、错误及最终回答各有独立类型，不误判为 thinking；历史记录和导出报告默认只包含正文，必要时由用户显式选择包含思考摘要（不默认导出原始 reasoning）。
5. 长思考增量批处理和虚拟化渲染，避免滚动跳动、卡顿、重复内容；模型不提供 reasoning 时不显示空卡片。

## 6. 改造 D：计划模式与自动审批（问题 4）

**主要文件：** `shared/execution-plan.ts`、`agent/pi-host.ts`、`pi-change-plan.ts`、`change-plan.ts`、`change-plan-policy.ts`、`command-classify.ts`、`command-approval.ts`、`pi-terminal-bash.ts`、`components/ChangePlanReview.tsx`、`AgentPanel.tsx`。

### 6.1 先确认现有计划模式，再扩展

当前 planned 模式是真的：启用 `submit_change_plan`，做身份检查、前置条件、备份、人工审批、逐步执行、停止和经另行审批的恢复。其当前变更命令主要限于受约束的 `cp/install`、`systemctl` 及带上下文的 `kubectl scale`，不能宣称已经覆盖任意运维计划。

补齐：计划生成与展示、目标集群/namespace/资源和排除范围、预检查、备份与校验、人工修改/拒绝、变更与验收、停止条件、结果未知处理、已批准计划不可越界、关闭窗口/换目标自动撤销。需要状态面板清楚标记 `planned` 与 `immediate`，历史保存执行证据（脱敏），审批凭证不跨 run 复用。

### 6.2 自动审批必须与“计划/立即执行”正交

建议增加**审批策略**，不是把原 `low/high` 全局改成自动放行：

| 操作类别                                        | 默认     | 用户启用“安全自动审批”后                   |
| ------------------------------------------- | ------ | ------------------------------- |
| 经静态规则确认的只读检查（不暴露敏感内容）                       | 自动     | 自动                              |
| 高风险标签但经确定性规则证明没有状态变更的检查                     | 人工或限制  | 在显式授权范围内自动，详细记录原因               |
| 风险未知、复杂 shell、外部可变副作用、可能泄露凭据的查询             | 人工     | 仍人工，除非用户针对**具体命令+具体目标+有效期**单次授权 |
| 任何本地/远端文件修改、服务启停、K8s 写操作、数据库修改、删除、进程信号、权限变更 | 人工     | **仍人工**；用户选择“人工执行”时 Agent 只生成命令 |
| MCP 外部写/网络副作用、工具安装、登录范围扩大                   | 人工     | 仍人工，保留现有逐次 MCP 审批边界             |
| 审核超时/分类失败/目标不明                              | 拒绝自动审批 | 拒绝自动审批（fail closed）             |

实现 `approvalPolicy`：`manual` / `safe-auto`，可选按会话、连接、操作类别和 TTL 限制，默认只在当前会话生效，不持久化广泛授权。对“高危命令自动审批”的定义应明确为**危险标签不等于真实写操作**：仅确定性证明无变更且满足数据泄露边界才可自动通过；不得因为 LLM 说它只读就放行写操作。

UI 展示“自动批准：命中只读策略/目标/时间”，保留审计；无用户授权的实际变更不得借计划模式或子终端绕过。

### 6.3 计划验收

在纯 mock 环境验证一次完整：调查 → 计划草案 → 明确目标 → 用户审批 → 变更 → 备份验证 → 结果。另测拒绝、计划篡改、目标切换、延期批准、窗口关闭、步骤超时结果未知、恢复批准与取消。不得在生产环境运行模拟写命令。

## 7. 改造 E：主终端/子终端智能路由与本地文件阅读（问题 5）

**主要文件：** `agent/pi-open-subterminal.ts`、`pi-terminal-bash.ts`、`pi-host.ts`、`terminal/ipc.ts`、`hooks/useTerminalTabs.ts`、`components/TerminalPane.tsx`、`SubterminalPanel.tsx`、preload/shared 目标类型。

1. 资料读取来源与命令执行目标分开。本地读取 `/Users/...` 应优先使用**受控、本机只读文件工具**，不必每次开本地子终端，更不能把之后的集群 bash 绑定改成本机。
2. 新增主机端 `select_execution_target` / `return_to_main_terminal` 能力，或等价的明确路由接口。Agent 可以“临时在本地读取资料 → 自动恢复原 SSH 主终端”，但恢复前校验 parent 是否存在、代次是否一致、托管连接是否 ready。失败则提示选择，不自动落到本地执行。
3. 对需要真实本机 shell 的行为，`open_subterminal(mode=local)` 应支持**有作用域的临时切换**：子任务结束后恢复 parent。其他 SSH 连接、并行子智能体和持续子终端保留各自独立目标，不覆盖 parent。
4. 每条命令卡与输入框附近显示目标 chip：`本机 · 主终端`、`集群名称 · 主终端`、`本机 · 子终端`、`另一个连接 · 子终端`；点击可查看 pane、连接、目标和当前状态。执行前主进程仍需再校验。
5. 模型工具描述明确 Pi `read/edit/write` 作用于本地工作区，`bash` 作用于绑定终端；不得凭 prompt 内容猜测跨文件系统路径。跨主机数据传输必须显式授权。
6. 子终端关闭、断开、超时、回到 parent、用户切换活跃 tab、Handoff、子智能体完成，都要有可预测的路由栈清理；不要因 UI 选择改变正在执行命令的目标。

### 7.1 文件阅读能力：先原生集成、再可选插件

优先使用现有 Pi 本地 `read` 能力与 Crescent 的 Markdown/知识库展示组件，补充一个主进程只读 `LocalDocumentReader`，有路径授权、文件大小/页数限制、范围读取、关键词搜索、行号/页码引用、编码检测、二进制拒绝与取消功能。UI 提供文件树、搜索结果、Markdown/代码/PDF 预览、引用片段插入对话，不将整个大文件一次性送给模型。

推荐候选（均运行在 Mac 客户端，不进入集群）：

- **ripgrep**：目录与代码的关键词搜索；可优先内置/打包可执行文件或用兼容的纯 Node fallback。
- **Monaco Editor** 或 **CodeMirror 6**：代码/日志分行、跳转、语法高亮和搜索；按需懒加载，避免使启动包和 Renderer 内存失控。
- **PDF.js**：PDF 阅读渲染、逐页定位和引用。
- **Microsoft MarkItDown / 官方 MarkItDown MCP**：DOCX/XLSX/PPTX/PDF 到供模型阅读的 Markdown。它是可选转换器，不应成为基础文本阅读的必需依赖；Python 运行时/打包、超时、沙箱和敏感文件外传风险必须审查。
- **官方 Filesystem MCP**：仅作为可选替代，不建议直接全权挂载用户家目录。最好为每会话提供受限的只读根，并在 Crescent 侧复核路径与符号链接。

本地原始内容不应自动上传第三方转码 API；远端日志、秘钥和个人数据默认脱敏/限制预览。图片 OCR/视觉转换如需调用云模型，必须获得用户确认。

## 8. 改造 F：可编辑“集群常用指令目录”（问题 6）

**UI 建议：** 放在顶栏现有 Wiki/工具区附近，新增一个“命令手册”图标（书签/终端图标均可）；点击打开与现有 Wiki 一致的可搜索侧边抽屉，避免常驻挤占终端或对话高度。窄屏时用全宽弹层。

支持：

- 分类：通用 Linux、Kubernetes、MongoDB/Redis/MySQL/ES、Nginx/网关、日志、网络、备份、故障排查；分类可编辑。
- 范围：**全局 / 连接 / 集群** 三层。集群绑定使用稳定 connection/cluster ID，不靠主机名字符串匹配；可复制模板到其他集群。
- 条目字段：名称、说明、命令模板、标签、适用环境、风险等级（仅展示）、预期输出说明、参数占位符、维护时间、来源、备注。
- 操作：新增、编辑、删除前确认、搜索、筛选、收藏、拖动排序、导入/导出 Markdown 或 JSON、版本/撤销。
- 模板参数示例：`kubectl --context={{context}} -n {{namespace}} get pods -o wide`。执行前必须展示**渲染后的完整命令、最终连接目标、风险审查结果**。参数按类型校验；绝不把模板内容默认视为可信自动审批白名单。
- “复制”“插入输入框”“发送 Agent 解释”“审查后执行”四个入口分开；只读模板可以快速执行，变更模板必须走统一审批。

优先复用 `WikiSheet`、Slash 命令、现有样式系统和 `crescent-store`/SQLite 的安全存储抽象；新增独立的数据类型、存储迁移与 IPC 校验，不在 Renderer 中直接访问文件系统。不要把命令模板和连接密码存入同一个可导出的明文配置。

## 9. 改造 G：Handoff 目标连接继承/重选（问题 7）

**主要文件：** `src/renderer/src/App.tsx` `createHandoffConversation()`、`hooks/useHandoff.ts`、`components/HandoffDialog.tsx`、`shared/handoff.ts`、tab 存储/恢复逻辑、连接启动队列。

1. 新增“交接到哪个执行环境”：`沿用当前连接（默认，仅当目标可验证）`、`选择已保存连接`、`本机`、`暂不连接（只交接资料）`。Dialog 显示源目标、目标连接、主/子终端角色与实际 SSH 状态。默认不得悄悄改为本机。
2. 新会话创建时保留明确目标的 `connectionId`、`connectionName`、期望 host/cluster scope、执行模式、会话组标识及必要的连接来源元数据；**不拷贝登录凭据、未完成命令、审批令牌、临时子终端 ID**。
3. 如果选中 SSH，先创建/恢复独立 SSH 终端并等待就绪、主机身份确认，再允许 Agent 执行命令。连接尚未 ready 时可以展示交接内容，但执行按钮禁用。严禁从新会话的本机 fallback 执行远端命令。
4. 原会话处于临时 local 子终端时，询问/默认从持久的 parent 主终端确定交接目标；不能误继承 local 子终端。源连接已经断开时允许保留目标意图，但新会话必须显式重连，不能假定旧 PTY 活着。
5. Handoff 文本应包含当前任务、已完成、待办、来源与目标身份、需要复查的信息；不继承隐含批准。跨不同集群交接时 UI 高亮“目标改变”，重新审查所有高风险命令。
6. `planned` 模式的交接可保留“计划执行偏好”，但审批必须重新获取且绑定新 run 和新目标。

## 10. 跨模块验收矩阵（自动化优先）

| 场景                                          | 必须观察到的结果                             |
| ------------------------------------------- | ------------------------------------ |
| 慢速 SSH / 多跳，8 秒后仍未见 start marker            | 显示启动待确认，不自动 Ctrl+C，不将连接判 lost        |
| 复杂 `awk`、引号、多行 here-doc、长 Base64 脚本         | 可靠写入、正确捕获 start/end，不卡 `>`；失败可说明精确阶段 |
| 运行 2～5 分钟并持续输出的只读检查                         | 允许继续等待，输出实时流式呈现，结果不被 10 秒截断          |
| 命令已经变更远端但完成 marker 丢失                       | `completion-unknown`，不自动重试；先只读核验     |
| 只读 `hostname` 第一次超时后再执行                     | 在连接身份确认后允许合理重试，而非本轮永久禁止              |
| 子终端并发/同 pane 双命令                            | 同 pane 串行，其他 pane 可独立执行，UI 不乱路由      |
| SSH 主终端 → 本地读文件 → SSH 命令                    | 读取文件后恢复原 parent；若 parent 不健康则阻断并明确提示 |
| 用户手动 SSH 与 SSH 卡片托管、特殊多跳                    | 按连接来源判断，不擅自切回本地或重连                   |
| 思考流式开启 / 关闭                                 | 运行期符合开关；完成后自动折叠；正文完整独立               |
| 计划模式的只读调查与变更计划                              | 只读可执行；变更必须生成计划并人工批准；状态一致             |
| 自动审批模式遇到未知 shell/高危写命令                      | 不自动放行，仍需人工确认；审核失败 fail closed        |
| 指令目录模板含修改操作                                 | 先显示真实目标和渲染命令，再走同一个审批器                |
| Handoff 从 SSH 发起                            | 默认预选同连接；新会话待连接就绪，不落到本机               |
| Handoff 切换到另一集群                             | UI 提醒目标切换、重新登录/确认，不继承原审批             |
| 关闭窗口、取消 run、会话恢复                            | 旧事件和旧批准无效，pending waiter 清理，无悬挂锁     |
| 超长文件、二进制、符号链接、敏感路径                          | 分片/拒绝/授权正确，安全地显示错误，不冻结 UI            |
| Windows/macOS arm64/x64 与 PTY/pipe fallback | 平台特性可降级但不丢失目标与审批边界                   |

## 11. Codex 实施顺序与交付要求

按依赖关系实施，不按截图序号机械排序：

1. **阶段 A：建立复现基线与测试夹具。** 确认 git 状态、Pi 工具边界、终端 PTY/pipe 事件；建立模拟 SSH、多跳、慢响应、续行输入、终端重载及失败指纹测试。先记录当前失败，再动核心逻辑。
2. **阶段 B：终端生命周期与超时控制。** 修改启动/运行/结束状态及健康分离；补充分块传输和取消/恢复测试。
3. **阶段 C：失败指纹、执行目标和子终端路由。** 引入结构化结果、作用域目标栈、显式恢复 parent 工具；保证不因读取本地文件丢失主 SSH。
4. **阶段 D：计划/审批策略。** 保留原安全门禁，增加精细自动审批模式并补齐计划状态测试；变更默认人工确认。
5. **阶段 E：Handoff 连接选项和新会话正确建链。** 完成跨连接/跨会话验收。
6. **阶段 F：思考区 UX 与运维指令目录。** 使用现有设计系统和状态管理，减少 App.tsx 继续膨胀。
7. **阶段 G：本地文件预览与可选文档转换器。** 首先做轻量只读能力；重型解析/Monaco/PDF 与可选 MCP 全部懒加载或子进程隔离。
8. **阶段 H：全平台和打包回归。** `npm run ci`、`npm run test:local`、真实无变更 SSH 验收、Mac Intel/Apple Silicon 打包验证。遵守仓库 AGENTS 的提交规则，未经用户要求不 push、不发布。

每个阶段提交：修改文件清单、核心设计取舍、测试覆盖表、失败/回归记录、UI 截图（如适用）、尚存风险与回滚方案。特别是主终端执行协议，需提供故障注入测试，不以“把 8s 改成 180s”算完成。





