# Agent 工具

Agent 只使用一组小而可审核的工具：

| 工具 | 作用 |
| --- | --- |
| `read` / `write` / `edit` | 读写 Agent 工作区内的文件。工作区默认是 `~/.crescent/workspace`，可在设置里改 |
| `bash` | 在主终端执行。`open_subterminal(mode=local)` 可以借走下一条本机命令，然后回到主终端。每条命令都看得到，高风险命令仍要 [审核](/guide/command-review) |
| `open_subterminal` | 停靠本机或另一台主机的窗格，不把主任务搬走。详见 [子终端与子代理](/guide/subagents) |
| `subagent` | 在子终端收集旁路信息。主终端继续工作 |
| `create-skill` / `create-sop` | 把这次会话整理成 Skill 或 SOP 草稿，确认后才写入。详见 [Skills 与知识库](/guide/skills) |

## 流程 {#flow}

<ArchitectureDiagram name="tools-zh" />

文件工具只进入 Agent 工作区。`bash` 先经过 [命令审核](/guide/command-review#flow)，再写入可见终端。`open_subterminal` 和 `subagent` 各自占用一个停靠窗格，说明见 [子终端与子代理](/guide/subagents#flow)。沉淀工具只打开确认对话框，确认后才写入，见 [Skills 与知识库](/guide/skills#flow)。

早期版本里的 OpenAPI 和 MCP 工具已经从 Agent 循环中移除。相关设置只保留给配置迁移，不能再被模型当成当前工具调用。

文件写入限制在 Agent 工作区。终端命令走可见会话和命令审核，不会在后台悄悄执行。子代理也不能调用 `subagent`、`open_subterminal`、`create-skill` 或 `create-sop`，这些只留给主会话。
