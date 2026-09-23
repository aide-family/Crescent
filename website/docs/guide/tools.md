# Agent 工具

Agent 只使用一组小而可审核的工具：

| 工具 | 作用 |
| --- | --- |
| `read` / `write` / `edit` | 读写 Agent 工作区内的文件。工作区默认是 `~/.crescent/workspace`，可在设置里改 |
| `bash` | 在当前可见终端执行，主终端或已停靠的子终端。每条命令都看得到，高风险命令仍要 [审核](/guide/command-review) |
| `open_subterminal` | 停靠一个专用的本地或另一条已保存 SSH 的子终端。详见 [子终端与子代理](/guide/subagents) |
| `subagent` | 把有边界的任务交给子代理，每个子代理独占一个停靠终端 |
| `create-skill` / `create-sop` | 把这次会话整理成 Skill 或 SOP 草稿，确认后才写入。详见 [Skills 与知识库](/guide/skills) |

早期版本里的 OpenAPI 和 MCP 工具已经从 Agent 循环中移除。相关设置只保留给配置迁移，不能再被模型当成当前工具调用。

文件写入限制在 Agent 工作区。终端命令走可见会话和命令审核，不会在后台悄悄执行。子代理也不能调用 `subagent`、`open_subterminal`、`create-skill` 或 `create-sop`，这些只留给主会话。
