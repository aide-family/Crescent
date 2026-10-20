# Crescent v1.0.12 终端与 SSH 稳定性专项改造

日期：2026-10-20。范围：本地工作区源码修复、本地测试与开发态 Electron 验收。

未提交、未推送、未制作安装包、未连接生产环境。开始工作前已有的暂存区补丁保持不变；本次修改留在工作区。测试文件继续仅在本地存在并受 Git 忽略。

## 根因与处理

| 故障                    | 根因                                                                                                                   | 修复后的行为                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地读取失败            | `read` 只支持文本文件，目录产生错误；相对路径固定使用工作区；所有根目录一起 canonicalize，失效工作区会拖累有效授权目录 | 本机目录可列表，支持 `~`、绝对路径及工作区/已授权目录内唯一相对路径；有效选择器授权不受失效工作区影响；分类返回不存在、未授权、系统权限、符号链接、编码、文件超限及取消错误和恢复建议    |
| 执行目标切错            | 本地子终端默认只绑定一次 bash；主终端登录回调会夺回子终端路由；子 Agent 使用缓存 SSH 标识                              | 默认保持子终端，只有明确 `temporary=true` 才执行一次后返回；主进程的 pane、PTY 代次、连接、主机、cwd 与 Shell 为目标权威；健康子终端不被登录回调切走；子 Agent 独立绑定并禁止回退        |
| Vim 等触发重连          | 连接判定扫描历史输出，未识别 alternate-screen 和光标控制；应用内容与宿主 UI 提示也可能进入漂移判断                     | 仅解析当前 PTY 的新鲜尾部提示符；流式处理跨 chunk 的控制序列，隔离历史、宿主显示和 TUI 内容；已知编辑器、分页器、交互 SSH/提权 Shell 使用人工接管，含 sudo/env/command/Shell 包装        |
| 超时、Ctrl+C 后无法执行 | 未确认记录在 Promise 回调中才登记，可能晚于新提示符；程序打印的 `^C` 被当作人工中断                                    | 同步登记命令状态再发 Ctrl+C；仅实际输入中断或运行取消具有中断权威；新鲜 Shell 提示符/原完成标记解除未确认栅栏；超时不自动重发、不自动判 SSH 丢失；等待输入和 TUI 阶段允许人工键入        |
| 嵌套 SSH 与异常恢复错误 | 手动 SSH 无条件清空原连接来源，缺少可回退的 Shell 跳转记录；前端在恢复后重放原 Agent 输入                              | 保留来源/连接身份并记录已观察到的 SSH Shell 跳转栈；进入/退出需要用户输入与新鲜提示符共同收敛；单次文本漂移只阻断执行，不销毁 PTY；取消恢复后的自动任务重放；远程 PTY 退出后需要明确重连，包括无已保存连接 ID 的手动 SSH |

Shell 状态包括：Shell Ready、Command Running、Interactive Application、Awaiting Input、Interrupted、Completion Unknown、Session Exited。状态与审批身份分离，活动状态变化不会错误撤销稳定目标绑定。完成标记同时回传实际 `$PWD`；本次确认的目录切换可更新当前执行绑定，但旧计划/只读授权仍按原有身份规则失效。

Handoff 使用当前执行 pane 的主进程上下文；资料型 Handoff 不能执行，新 SSH 会话必须独立登录。当前为嵌套 SSH 或没有可独立复现的已保存登录路径时，Handoff/子 Agent 要求显式选择环境，不能回到原连接或本机猜测执行。

## 修改文件

以下均为相对项目根目录的源码路径。

- 本地文件：`src/main/agent/pi-local-files.ts`、`src/main/local-document-reader.ts`、`src/main/local-document-ipc.ts`、新增 `src/main/local-document-errors.ts`。
- 目标与子 Agent：`src/main/agent/pi-terminal-bash.ts`、`src/main/agent/pi-open-subterminal.ts`、`src/main/agent/pi-subagent.ts`、`src/shared/agent-types.ts`。
- 终端状态与恢复：`src/main/terminal/ipc.ts`、`src/main/terminal/session-health.ts`、`src/main/terminal/pending-command.ts`、`src/main/terminal/timeout-recovery.ts`、`src/main/terminal/command-interrupt.ts`、`src/main/terminal/output-format.ts`、新增 `src/main/terminal/execution-state.ts`、新增 `src/main/terminal/ssh-hops.ts`、`src/shared/connection-state.ts`。
- Preload 与 UI：`src/preload/modules/terminal.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/components/ExecutionTargetChip.tsx`、`src/renderer/src/components/HandoffDialog.tsx`、`src/renderer/src/hooks/useHandoff.ts`、`src/renderer/src/hooks/useXtermLifecycle.ts`、`src/shared/handoff.ts`。
- 本交付记录：`Document/Crescent_v1.0.12_Terminal_SSH_Stability_Acceptance_20261020.md`。

## 本地回归

使用真实 `node-pty`、macOS 系统 `sshd` 和临时 Ed25519 测试密钥。两个隔离 SSH 服务只绑定 `127.0.0.1` 随机端口，ForceCommand 启动标记为 node-a/node-b 的不同测试 Shell；它们是同一台开发机上的两个服务端点，不是两台物理主机。外层和远端分别覆盖 `/bin/bash`、`/bin/zsh`。测试结束关闭服务、PTY 并删除临时密钥和目录。

`src/main/terminal/stability-pty.test.ts` 的 10 项真实传输测试覆盖：

- 本地子终端连续 5 条命令，保持同一 PTY；关闭后无静默回退。
- Vim 打开带伪主机提示符的文件，编辑、保存并退出；PTY 代次不变，没有漂移重连事件。
- 手动嵌套 SSH 到 node-b，执行命令后退出返回 node-a；原始连接来源保持不变。
- SSH 命令执行超时，Ctrl+C 后确认新提示符并执行下一条命令；写入计数仅 1 次。
- Handoff 新目标登录前不能执行；原 SSH 退出后也不能在本机执行远程命令。
- 真实工作目录回传，以及异常 SSH 退出、显式重新登录后不重放写操作。
- 子 Agent 的真实子终端绑定与父 SSH 独立；关闭子终端后拒绝执行。

其他新增/补充本地测试包括授权选择器与窗口生命周期、失效工作区、敏感路径、错误分类、目录读取、跨 chunk alternate-screen、ANSI/OSC 自定义提示符、历史伪提示符、带 sudo/env/Shell 包装的交互工具、跳转栈、持久子终端路由、子 Agent 隔离、中断竞态、打印 `^C` 的普通输出、TUI 人工接管、粘贴执行时的 Agent 注入隔离和 Handoff 当前目标身份。

最终命令：`npm run ci`、`npm run test:local`、`git diff --check`。完整本地测试为 36 个文件、219 项全部通过。CI 包含 lint、安全边界检查、Node/Web 类型检查和构建。仓库已有的 3 处 Prettier warning 位于 crescent-store/WhaleMonitor 相关文件，本次未改动这些既有改动。

开发态 Electron 使用独立 `CRESCENT_DATA_DIR`、`CRESCENT_USER_DATA_DIR` 启动。已实际展开执行目标，显示本机、主终端、Shell 就绪和工作目录；`pageErrors=[]`，Renderer 中 `require` 和 `process` 均为 undefined，Preload bridge 存在。恢复按钮的可见条件使用主进程实时状态；已在实际界面键入本地 sleep 命令，观察“命令执行中”，点击“中断并等待 Shell”后回到“Shell 就绪”。其他中断/恢复行为由上述真实 PTY 测试验证。

## 验收边界与剩余风险

- 没有调用真实模型，也没有使用用户保存的连接、凭据或生产集群。审批/工具与 IPC 的自动化测试包含 mock；真实 PTY 与回环 SSH 是实际进程和网络传输，不应等同于生产主机验收。
- 已验证包含主机信息的自定义 ANSI/OSC 提示符。完全不含主机身份、无法识别的提示符会保守阻断自动执行，需要恢复可识别提示符或明确选择并验证目标；不会据此自动重连或降级到本机。
- 通过 Shell 别名、历史编辑、脚本内部隐藏的 SSH/Shell 切换可能无法登记为明确的手动跳转意图；遇到不能证明的目标变化仍阻断执行。只有观察到的 SSH Shell 层进入栈，ProxyJump 网络转发不冒充交互 Shell 层。
- 交互应用交由人工控制；没有新增用于自动操纵 Vim、密码、su Shell 的 Agent API。macOS 系统 TCC 授权仍须用户在系统界面授予，程序只提供分类错误与正确入口，不绕过系统权限。
- 未制作和验证安装包，也未在其他操作系统或不同物理主机上验收。
