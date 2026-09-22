# Agent tools

The Agent runs a small, reviewable tool set:

| Tool                      | Role                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `read` / `write` / `edit` | Read and change files inside the Agent workspace                                                   |
| `bash`                    | Run in the visible terminal. Every command is observable, and high-risk commands still need review |
| `open_subterminal`        | Dock a dedicated local or SSH terminal for work that crosses contexts                              |

OpenAPI and MCP tools from earlier versions are no longer part of the Agent loop. Their settings remain only so old configuration can migrate. The model cannot call them as current tools.

File writes stay inside the Agent workspace. Terminal commands go through the visible session and [command review](/en/guide/command-review). They do not run in a hidden background shell.
