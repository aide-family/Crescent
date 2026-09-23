# Skills and knowledge

Crescent loads Agent Skills from the configured directory. The default is `~/.crescent/skills`.

You can:

- Search and install from skills.sh
- Import a local `SKILL.md` file or a skill directory
- Optionally load `~/.agents/skills` read-only

The local knowledge base keeps operational notes you want to reuse. A troubleshooting record can become an SOP. Later Agent runs can retrieve it instead of leaving the steps in a single chat.

Skills describe a stable way of working. The knowledge base keeps the conclusion and steps from a specific incident. Both stay on the machine and are offered to the Agent when a task starts.

## Capture this session

Do not let the model write `SKILL.md` or a wiki file with `bash`, `write`, or `edit`. It should call a capture tool. Crescent drafts the text in the background, and nothing is written until you confirm.

| Tool | What it drafts |
| --- | --- |
| `create-skill` | A Skill draft. The default scope is this session; you can limit it to the current turn |
| `create-sop` | A wiki SOP draft, also written only after you confirm |

A title hint or a note can point the draft at the practice you want to keep. Until you confirm, the file is not in the Skill directory or the knowledge base.
