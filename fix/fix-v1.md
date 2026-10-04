# Crescent 终端身份、尺寸调整与 SSH 断连保护方案

版本：v1  
日期：2026-09-24  
范围：主终端与子终端的身份辨识、Agent 执行期间的终端布局调整、SSH/集群连接断开后的 Agent 执行保护。

## 1. 背景与目标

当前工作台同时展示主终端、Agent 生成的子终端和 Agent 对话。用户反馈有三类问题：

1. Agent 不容易区分主终端和子终端，操作者也难以确认命令实际会在哪个 pane、哪台主机上执行。
2. Agent 调用终端期间，用户感觉主终端和子终端的大小无法调整。
3. SSH 集群连接断开或超时后，终端可能回到本机或跳板机 shell。Agent 没有足够明确的状态信号，可能继续在错误主机上查询。

本方案的目标：

- 让每个终端的角色、执行归属、连接类型和目标主机持续可见。
- Agent 执行命令时仍可调整终端布局；输入锁不应锁住布局调整。
- SSH 目标未经重新验证时，Agent 命令必须停止在主机边界，不能落到本机或跳板机继续执行。
- 将连接身份与终端进程是否存活分开管理，避免把一个仍然存活的本地 shell 当作远端连接正常。

## 2. 当前实现观察

以下判断基于当前目录中的源码。当前目录没有 `.git` 元数据，因此无法确认本地源码是否与 GitHub 最新提交完全一致。

- 项目把 Crescent 作为宿主：主进程拥有 SSH、终端、子终端和命令审查；Pi 是嵌入式 Agent runtime。Agent 的 `bash` 面向可见终端，`open_subterminal` 用于在工作台中创建独立终端。该边界应继续保持。参见项目 [README](https://github.com/aide-family/Crescent) 与 `.cursor/rules/architecture-first.mdc`。
- 现有 UI 已有主终端/聊天区宽度分隔条、子终端区高度分隔条和多个子终端之间的宽度分隔条。Agent 执行时的 `TerminalLockOverlay` 只锁终端输入，外围容器使用 `pointer-events-none`。如果运行时仍无法拖动，需要检查覆盖层命中区域、拖动事件捕获、布局状态更新及 xterm resize 同步，不宜再增加一套互相冲突的尺寸状态。
- 当前主进程的环境守卫会根据终端输出识别目标对齐或环境漂移。但当连接状态缺失，或当前 prompt 无法解析、判定为 `unknown` 时，部分路径会继续执行。这是需要补成“目标状态不确定时拒绝 Agent 命令”的关键边界。

相关实现位置：

- `src/renderer/src/components/TerminalPane.tsx`
- `src/renderer/src/components/SubterminalPanel.tsx`
- `src/renderer/src/components/TerminalLockOverlay.tsx`
- `src/renderer/src/hooks/useXtermLifecycle.ts`
- `src/renderer/src/lib/pipe-terminal.ts`
- `src/renderer/src/App.tsx`
- `src/main/terminal/ipc.ts`
- `src/main/terminal/session-health.ts`
- `src/shared/connection-state.ts`
- `src/main/agent/pi-terminal-bash.ts`
- `src/main/agent/pi-open-subterminal.ts`
- `src/preload/index.ts` 与 `src/preload/index.d.ts`

## 3. 方案一：明确区分主终端与子终端

### 3.1 终端身份字段

由主进程维护并向 renderer 提供结构化终端上下文。不要只根据标题文本或绿色活动圆点推断目标。

建议每个 pane 至少能表达以下信息：

| 字段 | 用途 |
| --- | --- |
| `paneRole` | `main` 或 `subterminal`，表示主终端或子终端 |
| `paneId` / `tabId` | 稳定、唯一的终端标识 |
| `owner` | `user`、`agent` 或具体子 Agent 名称 |
| `executionMode` | `local` 或 `ssh` |
| `connectionId` / `connectionName` | 已保存 SSH 连接的身份 |
| `expectedTarget` | 预期目标主机、集群或连接别名 |
| `observedHost` | 最近一次从连接握手或 prompt 等可信信号观测到的主机 |
| `connectionPhase` | 连接状态，见第 5 节 |

这些字段应在创建 pane、绑定连接、重连、切换目标、关闭 pane 时由主进程更新。Renderer 展示这些数据，但不自行推断执行目标。

### 3.2 界面展示

- 主终端标题区固定显示 `主终端`，并展示 `本机` 或连接名及目标，例如：`主终端 · SSH · prod-cluster / node-12`。
- 子终端每个独立标题区显示 `子终端`、用途名称、创建者以及目标，例如：`子终端 · Agent 查询 · SSH · prod-cluster / node-13`。
- 本地终端与远端终端使用不同图标和文字标识。连接失败用琥珀色/红色状态，活动圆点只表示进程或 pane 活动，不能被解释为“远端目标已验证”。
- 如果终端回到跳板机，状态应明确显示 `跳板机` 或 `目标不匹配`，不能沿用原集群名称制造仍然在线的错觉。
- Agent 命令步骤显示执行位置，例如 `在「主终端 · prod-cluster」执行`。点击步骤可聚焦对应终端；该信息由命令事件中的 `tabId` 和主进程终端上下文生成。
- 连接名过长时，主机名/集群名保持可见，完整连接信息放入 tooltip 或详情面板。

### 3.3 视觉层级

采用现有紧凑桌面 UI 和终端色彩规范，不给每个 pane 加重叠卡片。通过标题文字、主/子终端图标、细边框强调和状态标签区分角色。目标身份在横向空间不足时允许截断，但目标状态不可只依赖颜色或 tooltip。

## 4. 方案二：Agent 执行期间仍可调整尺寸

### 4.1 把键盘锁与布局交互分开

- `agentBusy` 只应阻止用户向 Agent 正在使用的 PTY 输入键盘数据。
- 主终端/聊天区、主终端/子终端区以及子终端之间的拖动条，在 Agent 执行时仍可交互。
- `TerminalLockOverlay` 的命中区域限制在输入提示本身；不得在终端 pane 外层增加覆盖整块区域的 `pointer-events: auto` 遮罩。
- Agent 正在执行命令时，用户仍可拖动 pane。布局变化不应自动取消命令、切换命令目标或改变 pane 的连接身份。

### 4.2 尺寸与 PTY 同步

- 将“pane 的像素尺寸”和“PTY 的列/行数”视为相关但不同的状态。Renderer 用布局状态控制像素空间；xterm `FitAddon` 根据所在 pane 计算列数和行数，再通过已白名单的 IPC 通知主进程调用对应 PTY 的 `resize`。
- 每个终端实例各自观察自己的容器尺寸。拖动主终端分隔条只改变主终端尺寸；调整子终端区高度时，更新该区域内每个子终端的 xterm 与 PTY 尺寸；调整子终端宽度时，只同步受影响的子终端。
- Resize 事件按 `requestAnimationFrame` 合并，避免指针移动时产生大量 PTY resize IPC。最终 pointer up 时再执行一次精确 fit/sync。
- 调整尺寸时不重新创建 terminal session，不重置 scrollback、连接身份或 Agent 的 `executionTabId`。
- 为分隔条保留清晰的命中区域、hover/focus 状态和键盘操作。拖动结束、窗口失焦或 pointer cancel 时，清除全局 cursor/user-select 状态。
- 尺寸可以在当前窗口生命周期内保留。是否跨重启持久化是后续体验增强，不是解除 Agent 执行期间锁定的前置条件。

### 4.3 排查重点

实现前先确认用户所说的“大小”指的是：

1. 主终端与聊天区的左右宽度；
2. 主终端与子终端区的上下高度；
3. 多个子终端之间的左右宽度；
4. xterm 字体大小或滚动区域。

当前代码中前三种已有分隔条和状态。若只有在 Agent 执行时失效，优先检查实际运行 UI 的事件命中层级、busy 状态是否导致父容器禁用、pointer capture 是否稳定，以及拖动后 ResizeObserver 是否持续触发。不要通过关闭输入锁来恢复拖动。

## 5. 方案三：SSH 断连后 Agent 命令失败关闭

### 5.1 将目标状态与 PTY 进程状态拆开

一个 PTY 进程可以正常存活，但当前 shell 已从 SSH 目标退回本机或跳板机。因此至少维护两个不同维度：

- **终端进程状态**：PTY/PIPE 是否存在、是否正在恢复。
- **执行目标状态**：Agent 预期访问哪个连接/集群，当前是否已验证仍位于该目标。

建议连接阶段：

```text
local-ready
  └─ ssh-connecting
       ├─ ssh-ready
       ├─ ssh-degraded
       ├─ ssh-lost
       └─ ssh-restoring ──> ssh-connecting
```

远程目标 pane 的执行许可只在 `ssh-ready` 且目标身份匹配时成立。`ssh-degraded`、`ssh-lost`、`ssh-restoring` 和无法确认目标的 `unknown` 都必须拒绝 Agent 命令。

### 5.2 统一连接状态转换

主进程是连接状态的唯一写入方。以下事件应立即使目标进入 `ssh-degraded` 或 `ssh-lost`，并撤销执行许可：

- SSH 登录流程、握手或连接命令超时；
- SSH 子进程退出或退出码表示连接失败；
- prompt 显示本机、跳板机或与预期目标不符的主机；
- 终端 session 退出、重建或出现无法确认身份的输出；
- 连接状态缺失、prompt 解析结果为 `unknown`，但该 pane 仍绑定 SSH 目标。

终端重建成功不代表远端重连成功。如果 Electron 为可交互性启动了本地 shell，底层 terminal session 可以恢复，但逻辑目标仍然是 SSH，Agent 必须保持禁用，直到重连并验证目标。不能因为本地 shell 可执行命令就自动在本地继续执行。

### 5.3 Agent 命令的主进程硬门禁

在主进程实际向 PTY 写入命令前，对全部 Agent `bash`/`terminal` 调用执行目标检查：

```text
目标为 local：允许执行（仍走现有命令审查与权限策略）
目标为 ssh 且状态为 ready、身份匹配：允许执行
目标为 ssh 且断开、恢复中、不匹配或未知：拒绝执行，不向 PTY 写入任何字节
```

门禁必须覆盖只读查询，因为查询落错机器同样会给出错误结论。拒绝结果应是结构化结果，不应模拟为空输出或普通 shell 错误：

```ts
{
  ok: false,
  code: 'SSH_TARGET_UNAVAILABLE',
  expectedTarget: 'prod-cluster / node-12',
  observedTarget: 'local-shell',
  connectionPhase: 'ssh-lost',
  recoveryAction: 'reconnect-or-select-target'
}
```

完成门禁后，通过 Agent event 把目标失败原因传给 Pi。系统提示可作为第二道行为提醒，但不能替代主进程门禁。

### 5.4 恢复交互

- 终端顶部显示持续状态条：`SSH 已断开 · 预期 prod-cluster / node-12 · 当前本机 shell`。
- 断连期间 Agent 的命令步骤返回明确失败，Agent 收到目标和恢复原因后停止查询，不应循环重试。
- 提供 `重新连接` 与 `选择其他目标` 操作。只有用户明确将目标切换为本机时，Agent 才能在本机继续执行。
- 重连成功后，以现有登录确认、prompt host 对齐、集群主机规则和跳板机识别机制验证最终目标。仅登录到跳板机不代表目标集群已就绪。
- 只有验证成功后，主进程才将状态切回 `ssh-ready` 并恢复 Agent 命令许可。
- 按现有恢复重试预算限制自动重连次数；恢复失败就保持阻断并要求用户处理。

### 5.5 子终端与 Agent 绑定

- Agent run 保存明确的 `executionTabId`、pane role 和预期目标，不通过“当前选中的 tab”隐式决定命令位置。
- 关闭子终端导致 `No active terminal session` 时，可以按现有设计回到父 pane，但回退前必须重新检查父 pane 的目标状态。若父 pane 的 SSH 也断开，返回目标断开错误，不能把命令写入本机 shell。
- `open_subterminal(mode=ssh)` 仍只用于有意登录另一条已保存连接。它不能被用来绕过当前会话的断线保护，也不能把当前 SSH 目标悄悄换成一个新 pane。
- 多 Agent 子任务继续由 Crescent 宿主创建和管理，并绑定到对应的 docked subterminal；不把 Pi 插件或后台 shell 当作新的终端执行平面。

## 6. 过程与代码边界

按 Electron 与 Pi 宿主边界分层实施：

1. **共享类型与状态转换**：在共享类型/连接状态模块定义终端角色、目标身份、状态阶段和结构化失败码；为每种转换定义纯函数，避免 UI 与主进程各自猜状态。
2. **主进程终端 SSOT**：在 `src/main/terminal/` 管理每个 pane 的连接目标、观测主机、连接阶段和 Agent 执行许可。SSH 断开/超时事件先撤销许可，再开始终端恢复。
3. **Agent host tool**：在 `src/main/agent/pi-terminal-bash.ts` 的命令实际执行边界调用门禁；将结构化错误传回 Agent。继续通过 `src/main/agent/pi-sdk.ts` 的动态导入边界使用 Pi。
4. **IPC 与 Preload**：只添加需要的白名单 IPC 和类型化事件。主进程校验 tabId/connectionId，renderer 不能直接访问 Node、PTY、SSH 或连接状态存储。
5. **Renderer UI**：在终端 tab、主终端栏和 `SubterminalPanel` 展示主/子角色、目标和阶段。布局尺寸状态和连接状态分离；执行中的输入锁不影响分隔条。
6. **恢复路径**：复用现有连接恢复流程和权限确认。不要把 prompt 文字解析、自动重连或模型提示单独当成安全边界。

不得引入 Electron EGG（`ee-core`），不得使用 `pi-mcp-adapter` 或 `pi-subagents` 作为产品面，不得在 renderer 内执行 Node/文件系统操作。

## 7. 建议实施顺序

### P0：防止误在本机执行

1. 定义目标状态与状态转换。
2. 在主进程 Agent 命令写入 PTY 前做 SSH 目标门禁，`unknown` 一律拒绝。
3. 让断线、超时、回到跳板机/本机 shell 的事件先撤销 Agent 执行许可，再触发恢复。
4. 给 Agent 返回稳定错误码与预期/观测目标信息。

### P1：让终端身份清楚

1. 给主 pane 和子 pane 提供明确角色标签。
2. 展示本机/SSH、连接名、最终目标与 Agent 执行状态。
3. 在 Agent 命令步骤中展示实际执行 pane 和目标。
4. 断连/恢复/跳板机状态使用明确文字和独立图标。

### P2：修复并巩固拖动体验

1. 在真实运行应用中复现 Agent idle 与 busy 两种情况下的主/子终端拖动。
2. 修复具体命中区域或 pointer 生命周期问题。
3. 验证各自 ResizeObserver、FitAddon 和 PTY resize 更新，不改变命令目标。
4. 补充分隔条键盘操作与拖动取消时的清理。

## 8. 验收标准

### 终端辨识

- 主终端和子终端始终有文字角色标签；本机、SSH 目标、跳板机和失联状态不能只靠颜色区分。
- Agent 正在运行时，可以从命令步骤确认命令实际 pane 与目标主机。
- 切换 pane、关闭/新建子终端、重连后，标签与命令实际执行位置保持一致。

### 尺寸调整

- Agent idle 和 busy 时均可以拖动主终端/聊天区分隔条、主终端/子终端区分隔条和子终端之间的分隔条。
- Agent 执行中的键盘输入仍按当前策略锁定；拖动和窗口缩放仍可用。
- 拖动后终端内容不被清空；每个受影响 PTY 的列/行尺寸与其 pane 匹配；未受影响 pane 保持原尺寸。

### SSH 断连安全

- 建立 SSH 目标会话后，模拟超时、SSH 退出回到本机、返回跳板机、prompt 无法识别、PTY 重建为本地 shell 等情况，Agent 查询全部被主进程拒绝，PTY 没有收到该查询命令。
- `connectionPhase=unknown` 且 pane 绑定 SSH 目标时必须拒绝，而不是默认为本机。
- 目标重新验证前，Agent 不会自行切换到本机或跳板机继续任务。
- 验证回到原目标后，可以恢复命令执行；明确选择本机目标后才允许本机命令。
- Agent 子终端关闭后的回退路径同样受父 pane SSH 目标门禁约束。

## 9. 验证建议

实现后需要分别验证纯状态转换、主进程 PTY 写入门禁、Preload IPC 参数校验、renderer 分隔条交互和实际 SSH 恢复流程。尤其需要检查“SSH 子进程断开但本地交互 shell 仍存活”这一真实场景。

仓库规则要求：Pi/Agent 单元测试只保留在本机，不得提交 `*.test.ts`；提交前按项目要求运行 `npm run ci`，若本地测试文件存在，再运行 `npm run test:local`。验证应针对实际运行的 Electron 应用，不应只根据静态代码或 build 结果宣称界面和 SSH 端到端问题已解决。

## 10. 风险与决策点

- 不同 SSH prompt、远端 shell、集群 hostname 规则可能导致误识别。目标身份应尽可能由 SSH 连接配置、连接生命周期和已验证的主机状态共同确定；纯文本 prompt 识别作为观测信号，不作唯一信任来源。
- ProxyJump 或多跳场景需要区分跳板机和最终目标。目标匹配规则必须明确“允许的中间 hop”与“任务最终执行目标”。
- 进程退出事件不覆盖所有网络断开场景。应同时使用 SSH 输出/退出信息、终端 prompt 观测和命令开始前的状态门禁，并对冲突信号失败关闭。
- 当前 `bash` 运行在可见 PTY 中。最小改造应在宿主主进程实际写入命令的边界保护目标身份，不通过扩大 Pi 插件面或在 renderer 中执行命令实现。

