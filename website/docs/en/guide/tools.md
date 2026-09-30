# Agent tools

The Agent runs a small, reviewable tool set:

| Tool | Role |
| --- | --- |
| `read` / `write` / `edit` | Read and change files inside the Agent workspace. The default workspace is `~/.crescent/workspace`, and Settings can change it |
| `bash` | Run on the main pane. `open_subterminal(mode=local)` may borrow the next command for the client machine, then bash returns to the main pane. Every command is observable, and high-risk commands still need [review](/en/guide/command-review) |
| `open_subterminal` | Dock a local or other-host pane without moving the main task. See [Subterminals and subagents](/en/guide/subagents) |
| `subagent` | Gather auxiliary information in a child docked terminal. The main pane keeps working |
| `create-skill` / `create-sop` | Draft a Skill or an SOP from this session. Nothing is written until you confirm. See [Skills and knowledge](/en/guide/skills) |

## Flow {#flow}

<ArchitectureDiagram name="tools-en" />

File tools stay inside the Agent workspace. `bash` goes through [command review](/en/guide/command-review#flow) before it is written into the visible terminal. `open_subterminal` and `subagent` each take a docked pane. See [Subterminals and subagents](/en/guide/subagents#flow). Capture tools only open a confirm dialog, and nothing is written until you confirm. See [Skills and knowledge](/en/guide/skills#flow).

OpenAPI and MCP tools from earlier versions are no longer part of the Agent loop. Their settings remain only so old configuration can migrate. The model cannot call them as current tools.

File writes stay inside the Agent workspace. Terminal commands go through the visible session and command review. They do not run in a hidden background shell. A child agent also cannot call `subagent`, `open_subterminal`, `create-skill`, or `create-sop`. Those stay with the parent session.
