# Crescent Runtime 实验

此目录是隔离 PoC，不属于 Electron 产品依赖或安装包。默认 Runtime 仍为 Pi 1.0.3。

## 复现

```bash
cd experiments/agent-runtime
npm ci
npm run typecheck
npm run bench
```

真实 OpenAI 兼容接口检查需要已有 `OPENAI_API_KEY`，可沿用 `OPENAI_BASE_URL`。默认使用 Responses API；兼容网关可显式选择 Chat Completions：

```bash
npm run bench -- --live
CRESCENT_POC_CHAT=1 npm run bench -- --live
```

可用 `CRESCENT_POC_MODEL` 选择端点支持的模型。真实检查只请求固定标记工具，最多 4 个回合、每次最多 128 输出 token、45 秒截止；工具没有 OS、文件、Shell 或网络权限。Tracing 关闭。报告不包含凭据或原始供应商错误。

## 已实现的适配面

`openai.ts` 和 `cline.ts` 使用实际 SDK 的循环、工具和流式事件，接入主项目的 `HostTool` 类型。`host-tools.ts` 在 Host 层串行化工具，并在排队结束时重新检查取消状态。调用顺序由 Host 保证；模型的 parallelToolCalls 设置不能作为执行顺序保证。

基准覆盖只读、批准写操作、拒绝、审批后目标漂移、SSH 不可用、超时、审批时取消、模拟 MCP 写入、模拟子 Agent、多个工具调用、未知命令和保存后恢复。传输和审批决策使用固定夹具，不执行真实 SSH、MCP、子 PTY 或写操作。模拟流的延迟不代表模型性能或成本。

这些原型尚未实现主程序完整的 `AgentRuntimeSession`：Pi steering、压缩、重试、上下文用量、子终端和 MCP 生命周期需要独立适配和实际验收。不得直接将其中一个设为生产 Runtime。

## 当前评估（2026-10-06）

| 维度                       | Pi 1.0.3                      | OpenAI Agents 0.18.0     | Cline Agents 0.0.90           |
| -------------------------- | ----------------------------- | ------------------------ | ----------------------------- |
| 产品主循环                 | 已由适配器接入                | 隔离原型                 | 隔离原型                      |
| Host 工具与流式输出        | SDK 夹具 + 打包应用验证       | SDK 夹具验证             | SDK 夹具验证                  |
| 审批 / 漂移 / 取消 / 超时  | 现有 Host 门禁与测试          | Host 夹具验证            | Host 夹具验证                 |
| Transcript 保存 / 恢复     | 当前产品持久化设计            | SDK 历史恢复原型         | SDK snapshot / restore 原型   |
| Steering / compaction 兼容 | Pi SDK 实测                   | 尚未完成                 | 尚未完成                      |
| 依赖审计                   | 产品依赖 0 漏洞               | SDK 未列为漏洞来源       | node-forge 依赖链仍有高危报告 |
| 真实模型调用               | 本次未访问用户真实 SSH / 模型 | 配置端点传输失败，未验收 | 本次未调用真实模型            |

实验图谱最初有 20 个漏洞报告；对 undici、busboy 和 provider-utils 做定向 overrides 后（尚未验证所有供应商），剩余 13 个高危条目均来自 node-forge 及其依赖传播。没有可用的安全 node-forge 版本可直接升级；不采用跨主要版本强制修复，也不将这条图谱加入产品。

## 替换方向

继续使用 Pi；先完善 OpenAI 原型的会话控制，再在同一 Host 门禁上进行真实端点与可见 PTY 验收。迁移须覆盖历史消息转换、事件顺序、工具输入输出、取消传播、用量统计、压缩和恢复。已有 Pi 会话应保留读取和回退入口，不能在运行中切换 Runtime。Cline 需先处理供应商依赖图谱和压缩/steering 差异。

详细结果：`out/implementation/runtime-benchmark.json`（项目根目录，本地忽略文件）。默认应用不启用 tool_search / codemode；Pi 隔离验证见本地 `src/main/agent/pi-upgrade.test.ts`。
