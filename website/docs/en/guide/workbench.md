# Workbench

Crescent keeps the conversation and the terminal in one window. Layout and how much the Agent talks can follow your habit. Safety rules stay the same.

## Layout

The workbench layout in Settings applies immediately and is kept for the next launch:

| Layout | What you see |
| --- | --- |
| Chat and terminal | Both panes, the default way of working |
| Chat only | Hide the terminal while you settle the goal and the conclusion |
| Terminal only | Hide the chat while you watch command output yourself |

The title bar can also swap which side the chat and the terminal sit on. You can ask for a confirmation before a terminal tab closes, so a live session is not stopped by accident.

## Working style

Working style only controls how much Crescent says to you. It does not skip checks, and it does not skip [command review](/en/guide/command-review).

| Style | Fit |
| --- | --- |
| Swift | Stay quiet during the run, then 1–3 sentences at the end. For people who already watch the terminal |
| Concise | At most one status line per stage, then a short conclusion. A good on-call default |
| Guided | Pair troubleshooting: goal, evidence, and the next step |
| Teach | Explain why something was checked and what the evidence means |

“Show thinking” overrides the style default. Swift, Concise, and Guided hide thinking unless you turn it on. Teach shows it.

System logs go to `~/.crescent/logs`, split by day and kept for 3 days. The default level is info. You can turn logging off or set it to debug.
