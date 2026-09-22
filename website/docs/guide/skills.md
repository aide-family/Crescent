# Skills 与知识库

Crescent 从配置的 Skill 目录加载 Agent Skills，默认目录是 `~/.crescent/skills`。

可以：

- 从 skills.sh 搜索并安装
- 导入本机的 `SKILL.md` 或整个 Skill 目录
- 可选地只读加载 `~/.agents/skills`

知识库用来留下可复用的运维经验。一次排障可以整理成 SOP，保存在本地知识库。之后的 Agent 运行可以检索这些记录，而不是只留在某次对话里。

Skill 描述稳定的做法，知识库留下某次现场的结论和步骤。两者都留在本机，由 Crescent 在任务开始时提供给 Agent。
