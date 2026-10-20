# Handoff v3 实施记录

日期：2026-09-27

已完成 `fix/fix-v3.md` 的原生 Handoff 实现，并重新构建应用。

## 实现

- 在“压缩上下文”旁新增“交接 / Handoff”按钮；保留压缩和 Trace 导出入口。禁用原因可通过 hover 或键盘焦点查看。
- 输入下一步目标后生成可编辑预览，支持 Escape 取消、错误重试、重新生成和复制。目标限制为 2,000 字符，提示限制为 24,000 字符。
- 确认后通过现有 tab 创建与 `agentInput` 路径建立独立本地对话，使用当前默认模型。保留原对话的历史及未发送输入，不继承 SSH 连接、工具审批或终端状态，不自动发送。
- 创建失败保留编辑内容；按 tab 隔离请求状态，丢弃取消后的迟到响应，并在确认前重新核对源会话版本。
- 主进程只接受白名单 IPC 参数，检查 session/tab 绑定、请求 ID、窗口归属、目标长度和 locale。生成使用独立 AbortController，超时 120 秒，同一会话的生成请求至少间隔 3 秒。
- Handoff 与 run、compact、runtime reload 共用会话忙碌状态及 mutex。修正 mutex 尾部清理与 reload 锁内复核，避免生成期间销毁会话。
- 使用安装的 Pi 0.84.0 SDK：`sessionManager.buildSessionContext()` 读取当前有效分支，保留最新压缩摘要与 retained messages；`ModelRuntime.completeSimple()` 独立生成文本。没有调用原会话的 prompt/compact，也没有注册工具或写交接文件。
- 上下文按消息边界与 UTF-8 字节预算筛选，优先保留摘要和最近消息；过大的摘要保留带截断标记的摘录。工具输出限制长度，图片等非文本内容使用占位说明，省略工具参数及推理内容。
- 复用并增强 `redactSensitiveText`，在预算裁剪前脱敏私钥、API key、Bearer/Authorization、配置凭据与 URL 密码；模型输出也经过脱敏。日志只记录 tab 哈希、耗时与安全错误类别。

## 验证

最终代码检查：

- `npm run ci`：通过。保留 3 条原有格式警告，位于 App 的 Wiki 提示、WhalePetPortrait、WikiSheet；无错误。
- `npm run test:local`：5 个文件、37 项测试全部通过，其中新增 23 项交接相关测试。
- 新增测试文件 `src/main/agent/handoff-context.test.ts`、`src/main/agent/handoff-host.test.ts` 仅保留在本地，符合项目的忽略规则。

本地单元验证使用真实 Pi SessionManager 检查分支选择和压缩摘要处理；使用可控 provider 验证取消、超时、限流、额度错误、空/过长/不完整输出、过期结果、并发互斥、无原历史写入及脱敏。

Electron 集成验证使用隔离数据目录与本地 OpenAI 兼容模拟服务，通过真实 renderer → preload → IPC → Pi SDK 链路验证：

- 空会话禁用、有效会话启用、目标空白/超长限制。
- Escape 取消生成、额度失败保留目标、重试成功。
- 编辑预览、模拟 tab 保存失败后保留文本、再次创建成功。
- 新 tab 的 composer 包含完整编辑后提示，创建没有触发额外 Agent 请求。
- 切换 tab 后两个草稿均保留，原会话运行历史未被交接改写。
- Trace 导出可生成 JSON；压缩按钮仍调用既有 compact IPC。
- 940×700 窗口下按钮可见，禁用交接按钮的键盘 Tooltip 正确，Enter 不会触发禁用操作。
- 刷新后的草稿行为与现有内存草稿约定一致。

本机验证产物：`/tmp/crescent-handoff-e2e/`（脚本、结果日志、界面截图、导出 Trace）；CI 与单测日志分别在 `/tmp/crescent-handoff-ci-final.log`、`/tmp/crescent-handoff-tests-final.log`。

## 保留的边界

- 草稿沿用现有内存生命周期，刷新或重启不恢复；对话框明确提示发送或复制保存。
- 没有活动 Pi session 的历史会话不能生成交接。
- 没有调用真实远程供应商；真实模型摘要的事实准确性仍需用户在预览中核对。
- 项目提供的技能文件为 `pi-dev` 和 `electron-development`；桌面样式依据 `.cursor/rules/` 与 `docs/UI_DESIGN_SYSTEM.md`。没有引入 EGG 或 Pi TUI 扩展。
- 当前工作目录不含 `.git` 元数据，本次没有创建 Git 提交。
