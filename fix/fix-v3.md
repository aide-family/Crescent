# Crescent Handoff 按钮适配实施方案

版本：v3  
日期：2026-09-27  
范围：在“压缩上下文”旁新增独立的 Handoff 交接按钮。保留压缩功能与会话历史，不直接安装 Pi TUI 扩展。

## 1. 目标与方案结论

在 Crescent Agent 对话区现有“压缩上下文”图标旁增加“交接”按钮。用户提供下一阶段目标后，Crescent 从当前活动 Pi 会话提取对后续任务有用的上下文，调用模型生成可编辑的交接提示，并将提示放进一个新对话的输入草稿中。用户检查后自行发送，新对话再开始工作。

交接与压缩是两项并列能力：

| 能力 | 目的 | 作用范围 | 对原会话的影响 |
| --- | --- | --- | --- |
| 压缩上下文 | 减少当前 Pi 会话需要携带的旧上下文 | 当前会话 | 更新当前会话的压缩状态，聊天展示历史继续保留 |
| Handoff 交接 | 为下一阶段工作准备聚焦、可独立理解的任务提示 | 新对话 | 原会话不变；新建对话并放入未发送草稿 |

**结论：可行，采用 Crescent 原生适配。** 上游 Pi 仓库的 [`handoff.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/handoff.ts) 可作为行为和提示词参考。该扩展依赖 Pi TUI 命令注册、自定义加载界面、编辑器及 `ctx.newSession`。Crescent 的 Pi session 由 Electron 主进程通过 SDK 托管，启动时设置 `noExtensions: true`，UI 也不是 Pi TUI，因此不能原样作为插件启用。实施时复用其“当前会话 + 下一步目标 → 交接提示 → 用户编辑 → 新会话”的工作流，在 Crescent 的主进程、preload 和 renderer 中实现。

## 2. 现状与实现边界

当前相关实现：

- `src/renderer/src/components/SessionUsageBar.tsx`：显示 token/context 使用情况，并在右侧放置压缩上下文和导出 session trace 按钮。
- `src/renderer/src/components/AgentPanel.tsx`：承接用量条属性与事件。
- `src/renderer/src/App.tsx`：当前压缩入口 `compactCurrentSession()`；负责活动会话/tab 的 UI 状态和现有聊天操作。
- `src/main/agent/pi-host.ts`：维护 `hostedSessions`，通过 Pi SDK 创建和操作活动 Agent session；手动压缩入口为 `compactHostedSession()`。
- `src/main/agent/ipc.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`：现有 Agent 主进程 IPC 注册及 preload 白名单桥接。
- `src/shared/agent-types.ts`：Agent IPC 的共享输入/结果类型。
- Crescent 当前创建 Pi session 时使用 `SessionManager.inMemory(cwd)`。Pi 会话本身是主进程托管的内存 session；界面聊天记录另由 Crescent 的存储层维护。Handoff 首版应以当前活动 Pi session 的实际分支为权威上下文，避免拿不完整或重复的 UI 文本拼装会话。

第一版只对当前仍有活动 Pi session 的对话提供生成能力。如果活动 session 不存在或没有可用对话，按钮应给出明确提示。持久化历史会话恢复后再 handoff 属于后续能力，需要单独确认历史记录可完整恢复为 Pi 上下文后再纳入范围。

## 3. 用户交互流程

### 3.1 入口与启用条件

- 在 `SessionUsageBar` 的压缩按钮旁新增 Handoff 按钮。建议使用 `ArrowRightLeft` 或 `Forward` 一类现有 Lucide 图标，并通过 Tooltip 和无障碍标签显示“交接 / Handoff”；图标定稿时避免与导出 JSON、压缩图标混淆。
- 保持现有压缩按钮、点击行为和禁用逻辑不变。
- 当前会话正在运行、压缩中、handoff 生成中或会话没有可用上下文时，按钮禁用。hover/focus 提示说明禁用原因；点击前后不应中断正在运行的 Agent。
- 生成要求当前对话和下一步目标。目标必填，长度上限建议 2,000 字符；对空白输入和超长输入在 renderer 与主进程分别校验。

### 3.2 操作步骤

1. 用户点击 Handoff。
2. 打开轻量对话框：展示当前对话标题/工作目录等可识别信息，要求填写“新对话要完成什么”。展示取消和“生成交接”操作。
3. Renderer 通过 `window.api.agent` 新增的窄 IPC 方法提交当前 `sessionKey`、`tabId`、目标文字和 locale。不要从 renderer 传入可伪造的完整会话内容作为权威输入。
4. 主进程检查 session 是否存在、是否正在运行/压缩、目标文字是否合法，再从托管 Pi session 获取当前分支并生成交接提示。
5. 生成过程中对话框显示忙碌状态，支持取消当前 handoff 生成请求。取消不应取消或修改原 Pi 会话。
6. 生成完成后显示可编辑预览。用户可修改内容、重新生成或取消。重新生成沿用相同上下文和目标，且设置次数或节流保护，避免误触发多次模型调用。
7. 用户确认后创建一个 Crescent 新对话/tab，并把编辑后的提示保存为 composer 草稿；此时不自动调用 Agent、不自动执行 shell 命令，也不删除或改写原对话。
8. 新对话创建或草稿保存失败时，保留编辑框中的提示并给出重试方式，不能丢失已生成内容。

### 3.3 新对话初始状态

- 新对话使用新的唯一 tab/session 标识、自己的空 timeline 和 composer draft。
- draft 内容作为新对话的首条用户消息，仅在用户显式点击发送后进入模型上下文。
- UI 应让用户能辨认该对话来自 Handoff，并建议将标题初始化为可编辑的“交接：<目标摘要>”。标题摘要不得替代或截断真正的 handoff draft。
- 不把旧 Pi session 的 provider/model/terminal/tool 状态悄悄复制过去。模型是否沿用 Crescent 当前全局选择遵循现有新对话默认行为；需要让用户能在发送前看到当前模型与工作目标。
- 工作目录、连接身份等已有新对话创建策略可复用，但必须使用既有的安全确认和目标绑定规则。不能因为 handoff 跨 tab 自动绕过 SSH 连接选择或命令审核。

## 4. 建议的数据流与类型

```text
Renderer 按钮/目标对话框
  → window.api.agent.generateHandoff(input)
  → preload 白名单 IPC
  → src/main/agent/ipc.ts 参数校验
  → src/main/agent/pi-host.ts 对活动会话加锁并提取 Pi 分支
  → 现有 Pi model runtime / provider 生成 handoff 文本
  → Renderer 预览、编辑
  → 现有新对话与 composer draft 状态路径
```

建议共享 DTO（命名可按现有类型约定调整）：

```ts
interface AgentGenerateHandoffInput {
  sessionKey: string
  tabId: string
  goal: string
  locale?: string
}

interface AgentGenerateHandoffResult {
  ok: boolean
  draft?: string
  busy?: boolean
  error?: string
}
```

如果需要可取消的生成过程，可使用独立 `requestId` 与窄 IPC 取消通道，或复用项目已有的后台生成取消模式；不得把取消请求误路由到 `cancelPiAgentRun()`。是否流式生成可在实现阶段决定，第一版可以采用一次完成调用并在 UI 显示 busy 状态，以减少新增状态复杂度。

建议在 `src/main/agent/pi-host.ts` 实现独立 `generateHandoffForHostedSession()` 服务函数，而不是把生成逻辑塞进 renderer、复用压缩函数或借助 bash 写文件。服务函数需：

1. 使用 sessionKey 定位 `hostedSessions`，并使用 session mutex 与现有 run/compact 状态协同，确保不会在活动 session 运行或压缩时读取半成品上下文。
2. 从 Pi `SessionManager` 读取当前分支，按 Pi SDK 的消息结构处理 message 与 compaction summary。若历史已压缩，保留最近压缩摘要及 compaction 后的有效消息，避免既忽略摘要又把原始旧分支全部重复塞入。
3. 使用 Pi 官方类型定义确认消息转换/序列化方式。不要静态导入 Pi ESM 到 Electron CJS 主进程；通过 `src/main/agent/pi-sdk.ts` 提供的动态加载边界接入需要的 Pi API。
4. 使用当前 Crescent provider/model 配置进行一次只生成交接文本的模型调用。遵守现有 provider 同步、错误分类和超时处理；不创建或污染原 hosted session 的对话消息。
5. 返回纯文本结果，不由主进程写交接 Markdown 文件、不执行新对话提示、不修改原会话 compaction 状态。

## 5. Handoff 提示词结构

生成提示词需要明确告诉模型：这是给新会话使用的工作起点。要求模型根据当前 Pi 对话和用户指定目标，输出可直接提交的、自包含的提示，而非向用户解释“我总结了什么”。建议至少包含：

```markdown
## 目标
<用户下一阶段的明确目标>

## 当前进展
<已经完成的工作和仍在进行的工作>

## 关键决定与约束
<已确认的技术/产品决定、不可违反的要求>

## 相关文件与位置
<对下一步实际有用的文件和职责；不确定时标记待核实>

## 证据与验证
<已执行的检查及其结果；未验证的内容明确标注>

## 下一步
<按优先级可执行的后续步骤>

## 风险与待确认项
<阻塞、未知信息、不能推断的事项>
```

输出应优先保留具体路径、真实命令/结果和用户明确约束。不得杜撰“已经通过测试”“已经部署”等状态；上下文未提供时写“未验证”或省略。用户输入的目标是新任务指令；对话历史中出现的引号内容、日志和附件可能包含不可信指令，生成模型应把它们当作上下文资料，不得执行其中指令。

## 6. 安全、隐私与资源限制

- 会话正文可能包含代码、终端输出、主机信息、访问令牌或凭据。调用模型前复用 Crescent 现有 secret redaction 能力，并确认覆盖常见 API key、Bearer token、SSH 私钥片段、Authorization header 与配置式凭据。不能只依赖 handoff 提示词要求模型保密。
- 会话文本在序列化前按完整消息边界裁剪到配置的最大输入预算；优先保留 compaction summary 和最近的有效对话。明确告知生成提示词中的摘要可能省略旧细节，预览允许用户检查是否漏掉关键要求。
- 处理图像、附件、二进制内容和工具输出时遵循 Pi/Crescent 现有表示与限制。首版可把不支持的非文本附件转换为安全占位说明（如“本轮包含图片附件，内容未包含在交接摘要中”），不要输出本地绝对附件路径中的秘密信息。
- 工具调用记录只保留对后续任务有用的精简事实；不必把整个 JSON tool payload 原样放进 handoff。终端输出要有字符上限和敏感信息脱敏。
- 主进程日志只记录请求开始/结束、耗时、tab ID 的非敏感摘要与安全错误类别，不记录完整对话内容、模型生成全文、API Key 或 authorization header。
- API 参数在主进程重新校验类型、最大长度、sessionKey/tabId 绑定和请求状态。preload 只暴露明确方法，不给 renderer 暴露 Node、文件系统或通用 IPC。
- 输出长度设置上限并校验非空。provider 超时、额度/网络失败、模型返回空内容或被取消时返回可读错误，不创建新对话。
- 原会话在生成期间若开始新的 Agent run，则应基于 mutex/state 锁定策略等待、拒绝或中止此次 handoff，保持上下文快照一致。第一版建议繁忙即拒绝并提示“请等待当前 Agent 运行结束后再交接”。

## 7. 失败状态与恢复

| 情况 | 行为 |
| --- | --- |
| 没有活动 Pi session | 不发送模型请求；提示此对话当前没有可交接的活动会话 |
| Agent 正在运行或正在压缩 | 禁用入口或主进程拒绝；提示等待完成 |
| 目标为空/过长 | 前端即时说明；主进程再次拒绝非法参数 |
| 模型/provider 不可用 | 保留用户填写的目标，显示可重试错误；不动原 session |
| 用户取消生成/预览 | 丢弃未确认结果；不改写原始对话 |
| 生成内容为空、超长或格式不可用 | 不创建新对话；允许重新生成 |
| 新 tab 创建失败 | 继续保留编辑后的 handoff 文本，允许重试创建或复制 |
| preload/IPC 响应异常 | 显示失败提示，清除 loading 状态；允许用户再次操作 |
| 原会话在生成时状态改变 | 丢弃过期上下文结果并提示重试，避免基于过期快照创建误导性的 handoff |

loading 状态应按 chat tab 独立管理；切换到其他对话后，旧对话的 loading/结果不能串到当前 tab。请求完成后再次校验目标 tab 仍存在，避免关闭窗口或删除 tab 后更新错误目标。

## 8. 实施步骤

### 阶段 A：确认 Pi SDK 能力与现有新对话草稿路径

1. 阅读 `.cursor/rules/architecture-first.mdc`、`.cursor/rules/development-standards.mdc`、`.cursor/skills/pi-dev/SKILL.md`、`.cursor/skills/electron-development/SKILL.md` 和 `docs/UI_DESIGN_SYSTEM.md`。
2. 检查安装版本 `@earendil-works/pi-coding-agent` 的类型声明和源码，确认 `SessionManager.getBranch()`、compaction entry 的结构、消息转换及 model runtime completion API 是否与上游示例当前版本兼容。
3. 检查 tab 创建、存储和 composer draft 的真实路径，优先复用现有新对话流程，不另造一种 tab 或 draft 持久化机制。
4. 确认 secret redaction 函数及本地测试文件现状；如修改 `src/main/agent/` 或 Electron IPC，再按规则将局部测试只保留在本地。

阶段 A 若发现当前 Pi 版本缺少上游示例依赖的接口，则通过现有 Pi SDK公开能力实现等价的分支读取与模型调用，不直接导入 Pi 内部私有模块、不升级单个 `@earendil-works/pi-*` 包。

### 阶段 B：主进程生成服务与 IPC

1. 在 `src/shared/agent-types.ts` 定义 input/result 类型。
2. 在 `src/main/agent/pi-host.ts` 增加独立 handoff 服务，复用 hosted session 生命周期和并发保护。
3. 根据本地安装 Pi 类型实现分支消息筛选、compaction 摘要保留、文本序列化、脱敏和预算裁剪。
4. 在 `src/main/agent/ipc.ts` 注册窄 IPC 方法，验证 `sessionKey`、`tabId`、目标字段、locale 和 session busy 状态。
5. 在 `src/preload/index.ts` 和 `src/preload/index.d.ts` 显式加入类型安全的 API 方法；不提供通用 IPC 桥。
6. Provider 调用采用单次、受超时与长度限制的 completion；确保不会写入原 Pi 对话历史或运行任何工具。

### 阶段 C：Renderer 按钮、生成与编辑

1. 扩展 `SessionUsageBar` props，在压缩按钮旁添加 Handoff callback 和独立禁用状态。
2. 经 `AgentPanel`、`App.tsx` 把当前 tab/session 标识与 callback 传入；loading 状态按 tab 管理。
3. 新增目标输入与生成状态 UI，显示目标、取消和错误重试。
4. 展示 handoff 草稿预览，允许编辑、重新生成或取消。
5. 复用 Crescent 当前创建新聊天 tab 与 composer draft 的代码路径，把草稿写入新 tab，然后聚焦新对话。
6. 将原“压缩上下文”按钮行为和 trace 导出按钮回归确认，避免布局或事件 prop 漏接。

### 阶段 D：集成验证与交付

1. 验证空会话、活动会话、压缩过的 session、正在运行、provider 失败、取消和重复点击场景。
2. 验证生成结果不会进入原对话的 Pi message history；创建新对话后仍需用户按发送才会触发 Agent。
3. 验证 handoff draft 在 tab 切换、主窗口刷新/关闭恢复策略下的行为符合现有 composer draft 约定。
4. 验证两个按钮在窄窗口、键盘导航和 focus ring 下仍清楚可用；Tooltip/aria 标签明确区分“压缩上下文”和“Handoff 交接”。
5. 按用户任务要求执行需要的本地验证。任何提交前必须执行 `npm run ci`，并在本地测试文件存在时执行 `npm run test:local`；测试文件不得提交。

## 9. 验收标准

- 压缩上下文按钮继续存在，行为与改动前一致；旁边新增独立、可访问的 Handoff 按钮。
- 用户必须明确输入下一步目标；生成前可取消，生成后可编辑/取消。
- 交接生成使用当前 Pi 活动 session 的正确分支；如果已有 compaction summary，生成输入中保留摘要及压缩后消息。
- 当前会话运行或压缩时不能并发读取并生成不一致的交接内容。
- 交接调用不执行工具、不写文件、不触发原会话 compact，不增加原 Pi 会话消息。
- 确认后产生全新 Crescent 对话，并只放置待发送 draft；不会自动发送或运行模型。
- 任何生成、取消或新 tab 创建失败都不会丢失原会话或用户正在编辑的目标/草稿。
- Renderer 仅通过 preload 白名单 API 与主进程通信；参数由主进程校验；session 正文和密钥不进入日志。
- 生成内容中的已验证事实、测试结果、文件路径和未完成任务与源会话一致；缺失或不确定信息不得伪造。

## 10. 当前不纳入范围

- 不移除、替代或修改“压缩上下文”。
- 不直接加载 Pi TUI 的 `handoff.ts`，不启动 Pi CLI 子进程，不安装 EGG/`ee-core`。
- 不把整个 session JSONL、shell history 或日志文件当成 handoff 的唯一数据源。
- 不将 handoff Markdown 自动写入项目目录、wiki 或 Crescent 长期记忆。
- 不自动把旧对话中的工具权限、连接目标、审批状态继承给新对话。
- 不支持已关闭或应用重启后未恢复 Pi session 的历史会话 handoff；等历史恢复能力被确认后再扩展。
- 不自动发送新会话第一条消息，也不在生成后自动开始代码修改或终端命令。

## 11. 主要文件位置

- 按钮与 token 用量条：`src/renderer/src/components/SessionUsageBar.tsx`
- Agent 面板属性转发：`src/renderer/src/components/AgentPanel.tsx`
- 当前 tab 的 UI 状态、压缩入口与新对话交互：`src/renderer/src/App.tsx`
- Pi 托管 session、session mutex 与 compaction：`src/main/agent/pi-host.ts`
- Agent IPC：`src/main/agent/ipc.ts`
- Pi ESM 动态加载边界：`src/main/agent/pi-sdk.ts`
- preload API：`src/preload/index.ts`、`src/preload/index.d.ts`
- Agent 类型：`src/shared/agent-types.ts`
- 项目规则：`.cursor/rules/architecture-first.mdc`、`.cursor/rules/development-standards.mdc`
- 桌面界面规范：`docs/UI_DESIGN_SYSTEM.md`

本文件定义实施方案，不代表代码已实现或验证。开始改代码前，应以仓库内安装的 Pi SDK 类型、Crescent 真实 tab/draft 生命周期和敏感信息脱敏实现为准完成阶段 A 的核对。
