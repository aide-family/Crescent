# Subterminals and subagents

The main terminal keeps working on the current task. Subterminals only gather other information. Do not leave the main pane idle and finish the task in a subterminal.

## Flow {#flow}

<ArchitectureDiagram name="subagents-en" />

`open_subterminal` only adds a pane for the current Agent. `mode=local` runs the next `bash` on this machine, then `bash` returns to the main pane. `mode=ssh` docks a different saved host and does not move parent `bash`. `subagent` gathers auxiliary information in its own docked terminal. Read-only profiles can run in parallel, up to 3 panes. The host rejects `worker` and `delegate`. A child cannot call `subagent`, `open_subterminal`, `create-skill`, or `create-sop`.

## Docked subterminal

`open_subterminal` opens a docked subterminal. Parent `bash` stays on the main pane.

- `mode=local`: while the current pane is remote SSH, the next `bash` can edit client-machine files such as `/etc/hosts`. After that command, `bash` returns to the main pane.
- `mode=ssh`: pass a different saved `connectionId`. This does not move parent `bash`. Do not open another subterminal for the SSH session you are already on.

Do not run concurrent `bash` on one pane. Same-session investigation stays on the main pane.

## Subagents

`subagent` gathers auxiliary information. Each child gets its own docked terminal. The parent’s `bash` stays on the main pane and continues the user task.

- One task: `{ agent, task }`
- Parallel tasks: `{ tasks: [{ agent, task }, ...] }`, at most 3 panes

Use parallel tasks only for independent read-only work. `worker` and `delegate` are rejected. A child cannot spawn another child, and it cannot replace a dead main SSH session. Wait for the host to restore that session, then retry `bash` on the main pane.

| Profile | Tools | Role |
| --- | --- | --- |
| `scout` | `read`, read-only `bash` | Fast recon of files, entry points, data flow, and risks. Does not edit |
| `researcher` | `read`, read-only `bash` | Gather facts from the workspace, docs, and command output, and cite sources |
| `reviewer` | `read`, read-only `bash` | Check correctness, edge cases, and extra complexity against the task. Does not make large edits |
| `oracle` | `read`, read-only `bash` | A second opinion before acting: gaps, risks, and a recommended next step |

`worker` and `delegate` are rejected. Changes and verification stay on the main pane. Crescent closes a child pane when that child finishes.
