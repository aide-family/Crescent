# Command review

Commands proposed by the Agent pass an independent review before they run. The review explains:

- Why the command is proposed
- Whether it may change system, cluster, file, network, service, credential, or data state
- The risk level
- Whether your approval is required
- The likely impact and recommendation

Clearly read-only checks can be allowed automatically. Mutating or ambiguous commands wait for confirmation.

Typical cases that need a person: deleting files, restarting services, privilege changes, writing files, and editing configuration. The Agent should speed up the investigation, not bypass judgment.

Review happens before the command reaches the terminal. You still see the final command and its output in the visible session.

## Risk levels

| Level | What usually happens |
| --- | --- |
| Low | Clear read-only checks can run automatically. Several read-only commands collapse into one group |
| Medium | Limited impact, or an unclear intent, waits for you |
| High | Deletes, restarts, privilege changes, file writes, and config edits wait until you approve them |

You can add a note when you approve or reject, for example “read-only only”, “wrong scope”, or “watch the target path”. If the session is already closed, a pending approval is cancelled.

## Command allowlist

The command allowlist in Settings lets commands you trust skip this AI risk review and run directly. One rule per line:

- Plain text: the whole command must match exactly
- A trailing `*`: prefix match
- `/.../`: a regular expression

The review card can also add the current command to the allowlist. An allowlisted command is still visible: it runs in the current pane, and you still see the output.
