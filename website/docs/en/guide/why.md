# Why Crescent

Many AI tools can generate shell commands. In real operations work, the harder problems are different:

- The model does not know which host, cluster, directory, or terminal session you are in.
- Generated commands still need to be copied in, and output copied back.
- Deletes, restarts, and configuration changes need a clear review before they run.
- Troubleshooting knowledge disappears after the incident is closed.
- Suggestions, terminal sessions, and operational notes live in different products.

Crescent keeps the Agent next to the real terminal so each step stays observable, reviewable, and reusable.

## How it compares

| Option               | Strength                | Limitation                            | Crescent                                           |
| -------------------- | ----------------------- | ------------------------------------- | -------------------------------------------------- |
| Plain terminal       | Direct and controllable | No context understanding              | Continues from real command output                 |
| General AI chat      | Strong explanation      | Cannot see the live terminal          | Connects execution, observation, and the next step |
| API testing tools    | Good for endpoints      | Weak for SSH and host troubleshooting | Stays in the terminal workflow                     |
| Automation platforms | Strong standards        | Less flexible for exploratory work    | Grows Skills and SOPs over time                    |

## Next

After you install the desktop app and configure an OpenAI-compatible model, start from the terminal. See [Install](/en/guide/install) and [Quick start](/en/guide/quick-start).
