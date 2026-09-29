# 子终端与子代理

主终端继续做当前任务。子终端只收集其他信息。不要让主终端停下来，只靠子终端把问题处理完。

## 流程 {#flow}

<ArchitectureDiagram name="subagents-zh" />

`open_subterminal` 只给当前 Agent 多开一个窗格。`mode=local` 让下一条 `bash` 在本机执行，然后回到主终端。`mode=ssh` 停靠另一台已保存的主机，不搬走父 `bash`。`subagent` 在自己的停靠终端里收集旁路信息。只读角色可以并行，最多 3 个面板。主机会拒绝 `worker` 和 `delegate`。子代理不能再调用 `subagent`、`open_subterminal`、`create-skill` 或 `create-sop`。

## 停靠子终端

`open_subterminal` 打开一个停靠的子终端。父 `bash` 留在主终端。

- `mode=local`：当前面板是远程 SSH 时，下一条 `bash` 可以改本机文件，例如 `/etc/hosts`。这条命令结束后，`bash` 回到主终端。
- `mode=ssh`：必须带另一条已经保存的 `connectionId`。这不会搬走父 `bash`。不要为当前这条 SSH 再开一个子终端。

同一面板上不要并发跑多条 `bash`。同一会话的主排查留在主终端。

## 子代理

`subagent` 用来收集旁路信息。每个子代理独占一个停靠终端。父代理的 `bash` 留在主终端，并继续用户任务。

- 单个任务：`{ agent, task }`
- 并行任务：`{ tasks: [{ agent, task }, ...] }`，最多 3 个面板

只有互相独立的只读工作才并行。`worker` 和 `delegate` 会被拒绝。子代理不能再派生子代理，也不能代替已经断开的主 SSH；主会话应等主机恢复后再在主面板重试。

| 角色 | 工具 | 做什么 |
| --- | --- | --- |
| `scout` | `read`、只读 `bash` | 快速摸清文件、入口、数据流和风险，不改文件 |
| `researcher` | `read`、只读 `bash` | 从工作区、文档和命令输出收集事实，并标出来源 |
| `reviewer` | `read`、只读 `bash` | 对照任务检查正确性、边界和多余复杂度，不直接大改 |
| `oracle` | `read`、只读 `bash` | 动手前的第二意见：缺了什么、有什么风险、下一步建议 |

`worker` 和 `delegate` 会被拒绝。修改和验证留在主终端。子面板在子代理结束后由 Crescent 关闭。
