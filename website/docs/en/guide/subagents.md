# Subterminals and subagents

The main terminal stays the worksite of the current session. For another machine, local files, or a separate line of checks, do not mix those commands into the same pane.

## Docked subterminal

`open_subterminal` opens a docked subterminal. Later `bash` calls can run there.

- `mode=local`: use this for work on the client machine, such as local files, while the current pane is a remote SSH session.
- `mode=ssh`: pass a different saved `connectionId`. Do not open another subterminal for the SSH session you are already on. The main terminal stays on that connection.

Do not run concurrent `bash` on one pane. Each parallel stream gets its own subterminal.

## Subagents

`subagent` hands a bounded task to a child agent. Each child gets its own docked terminal. The parent’s `bash` stays on the current pane.

- One task: `{ agent, task }`
- Parallel tasks: `{ tasks: [{ agent, task }, ...] }`, at most 3 panes

Use parallel tasks only for independent read-only work. Profiles that can change files run one after another. A child cannot spawn another child, and it cannot replace a dead main SSH session. Wait for the host to restore that session, then retry `bash` on the main pane.

| Profile | Tools | Role |
| --- | --- | --- |
| `scout` | `read`, read-only `bash` | Fast recon of files, entry points, data flow, and risks. Does not edit |
| `researcher` | `read`, read-only `bash` | Gather facts from the workspace, docs, and command output, and cite sources |
| `worker` | `read`, `bash`, `edit`, `write` | Implement the delegated change and say how it was verified |
| `reviewer` | `read`, read-only `bash` | Check correctness, edge cases, and extra complexity against the task. Does not make large edits |
| `oracle` | `read`, read-only `bash` | A second opinion before acting: gaps, risks, and a recommended next step |
| `delegate` | `read`, `bash`, `edit`, `write` | Finish one bounded task in this pane and return the result to the parent |

Finish the main task on the main pane. Crescent closes a child pane when that child finishes.
