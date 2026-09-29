# Agent tools

The Agent runs a small, reviewable tool set:

| Tool | Role |
| --- | --- |
| `read` / `write` / `edit` | Read and change files inside the Agent workspace. The default workspace is `~/.crescent/workspace`, and Settings can change it |
| `bash` | Run in the visible terminal, either the main pane or a docked subterminal. Every command is observable, and high-risk commands still need [review](/en/guide/command-review) |
| `open_subterminal` | Dock a dedicated local terminal, or a subterminal for a different saved SSH connection. See [Subterminals and subagents](/en/guide/subagents) |
| `subagent` | Hand a bounded task to a child agent. Each child gets its own docked terminal |
| `create-skill` / `create-sop` | Draft a Skill or an SOP from this session. Nothing is written until you confirm. See [Skills and knowledge](/en/guide/skills) |

OpenAPI and MCP tools from earlier versions are no longer part of the Agent loop. Their settings remain only so old configuration can migrate. The model cannot call them as current tools.

File writes stay inside the Agent workspace. Terminal commands go through the visible session and command review. They do not run in a hidden background shell. A child agent also cannot call `subagent`, `open_subterminal`, `create-skill`, or `create-sop`. Those stay with the parent session.
