# 运行时与适用人群

Crescent 是 Electron、React 和 TypeScript 桌面工作台。Agent 不脱离现场做判断，而是通过终端、工具和知识库补充证据。

## 使用关系

<ArchitectureDiagram name="usage-zh" />

进程边界、IPC 和当前重构顺序写在仓库 [docs/ARCHITECTURE.md](https://github.com/aide-family/Crescent/blob/main/docs/ARCHITECTURE.md)。那份文档是工程说明，这里只描述使用时能看到的关系。

## 系统架构 {#system}

工作台跑在 Renderer。它不直接碰终端、文件或密钥，只通过 Preload 暴露的 `window.api` 把请求交给 Main。

Main 持有终端和 SSH、命令审核、Skills、知识库，以及连接等本地配置。Pi 是客座运行时：它跑 Agent 会话，通过宿主注册的工具回到终端和沉淀，不单独持有 SSH 或密钥。

<ArchitectureDiagram name="system-zh" />

本地数据留在 `~/.crescent`：Agent 工作区、Skill 目录、知识库，以及已保存的连接。

## 主工作流 {#workflow}

一次排障从工作台进入宿主，在可见终端里收束，需要留下做法时再确认落盘。

<ArchitectureDiagram name="workflow-zh" />

1. 请求从工作台进入宿主。宿主按当前终端、已加载的 Skills 和知识库组装这次运行的现场。
2. Pi 会话选择下一步工具。文件工具只动工作区。跨机器或另一条检查线用子终端或子代理，说明见 [子终端与子代理](/guide/subagents)。
3. `bash` 先经过 [命令审核](/guide/command-review)，通过后才写入当前可见终端。输出回到会话，供下一步判断。终端侧的逐步说明见 [终端与 Agent](/guide/terminal#flow)。
4. 会话可以继续检查，也可以给出结论。
5. 若要把这次做法留下，调用 `create-skill` 或 `create-sop`。宿主只生成草稿，确认之后才写入。见 [Skills 与知识库](/guide/skills#flow)。

## 适合谁

- 每天靠 SSH 排障的运维工程师
- 负责 Kubernetes、Docker 和 Linux 主机的 SRE
- 希望把排障流程沉淀成 SOP 的平台团队
- 希望 Agent 落在真实终端、命令可审核的开发者
- 希望 AI 围绕真实环境工作、而不只是给命令建议的工程师
