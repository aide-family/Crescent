import type { ArchitectureSpec } from '@shared/architecture-spec'

export const usageArchitectureZh: ArchitectureSpec = {
  title: '使用关系',
  nodes: [
    { id: 'user', label: '用户请求', kind: 'client' },
    { id: 'ui', label: 'Crescent 工作台', kind: 'frontend' },
    { id: 'terminal', label: '本地 / SSH 终端', kind: 'ingress' },
    { id: 'agent', label: 'AI Agent Core', kind: 'service' },
    { id: 'audit', label: '命令审核', kind: 'auth' },
    { id: 'tools', label: '工具运行时', kind: 'service' },
    { id: 'files', label: 'read / write / edit', kind: 'data' },
    { id: 'bash', label: 'bash 可见执行', kind: 'service' },
    { id: 'subterm', label: 'open_subterminal', kind: 'queue' },
    { id: 'wiki', label: '本地知识库', kind: 'data' }
  ],
  edges: [
    { from: 'user', to: 'ui' },
    { from: 'ui', to: 'terminal' },
    { from: 'ui', to: 'agent' },
    { from: 'agent', to: 'audit' },
    { from: 'audit', to: 'terminal' },
    { from: 'agent', to: 'tools' },
    { from: 'tools', to: 'files' },
    { from: 'tools', to: 'bash' },
    { from: 'tools', to: 'subterm' },
    { from: 'tools', to: 'wiki' },
    { from: 'wiki', to: 'agent' },
    { from: 'terminal', to: 'agent' }
  ]
}

export const systemArchitectureZh: ArchitectureSpec = {
  title: '系统架构',
  nodes: [
    { id: 'workbench', label: '工作台', kind: 'frontend', group: 'renderer' },
    { id: 'bridge', label: 'window.api', kind: 'ingress', group: 'preload' },
    { id: 'host', label: 'Agent 宿主', kind: 'service', group: 'main' },
    { id: 'terminal', label: '终端与 SSH', kind: 'ingress', group: 'main' },
    { id: 'review', label: '命令审核', kind: 'auth', group: 'main' },
    { id: 'skills', label: 'Skills', kind: 'service', group: 'main' },
    { id: 'wiki', label: '知识库', kind: 'data', group: 'main' },
    { id: 'config', label: '本地配置', kind: 'external', group: 'main' },
    { id: 'session', label: 'Agent 会话', kind: 'service', group: 'pi' },
    { id: 'workspace', label: '工作区', kind: 'data', group: 'disk' },
    { id: 'skillDir', label: 'skills', kind: 'data', group: 'disk' },
    { id: 'wikiDir', label: 'wiki', kind: 'data', group: 'disk' },
    { id: 'connections', label: '连接配置', kind: 'external', group: 'disk' }
  ],
  edges: [
    { from: 'workbench', to: 'bridge' },
    { from: 'bridge', to: 'host' },
    { from: 'host', to: 'session' },
    { from: 'session', to: 'review' },
    { from: 'review', to: 'terminal' },
    { from: 'session', to: 'skills' },
    { from: 'session', to: 'wiki' },
    { from: 'terminal', to: 'session' },
    { from: 'skills', to: 'skillDir' },
    { from: 'wiki', to: 'wikiDir' },
    { from: 'host', to: 'config' },
    { from: 'config', to: 'connections' },
    { from: 'host', to: 'workspace' }
  ],
  groups: [
    { id: 'renderer', label: 'Renderer', kind: 'frontend' },
    { id: 'preload', label: 'Preload', kind: 'ingress' },
    { id: 'main', label: 'Main', kind: 'service' },
    { id: 'pi', label: 'Pi', kind: 'service' },
    { id: 'disk', label: '~/.crescent', kind: 'data' }
  ]
}

export const workflowArchitectureZh: ArchitectureSpec = {
  title: '主工作流',
  nodes: [
    { id: 'request', label: '用户请求', kind: 'client' },
    { id: 'context', label: '组装现场', kind: 'frontend' },
    { id: 'choose', label: '选择工具', kind: 'service' },
    { id: 'bash', label: 'bash', kind: 'service' },
    { id: 'other', label: '文件 / 子终端 / 子代理', kind: 'queue' },
    { id: 'capture', label: 'create-skill / create-sop', kind: 'auth' },
    { id: 'review', label: '命令审核', kind: 'auth' },
    { id: 'visible', label: '写入可见终端', kind: 'ingress' },
    { id: 'output', label: '输出回会话', kind: 'service' },
    { id: 'done', label: '结论', kind: 'frontend' },
    { id: 'confirm', label: '操作者确认', kind: 'client' },
    { id: 'persist', label: '写入 Skill 或 wiki', kind: 'data' }
  ],
  edges: [
    { from: 'request', to: 'context' },
    { from: 'context', to: 'choose' },
    { from: 'choose', to: 'bash' },
    { from: 'choose', to: 'other' },
    { from: 'choose', to: 'capture' },
    { from: 'bash', to: 'review' },
    { from: 'review', to: 'visible' },
    { from: 'visible', to: 'output' },
    { from: 'other', to: 'output' },
    { from: 'output', to: 'choose', label: '继续检查', style: 'dashed' },
    { from: 'output', to: 'done', label: '给出结论' },
    { from: 'capture', to: 'confirm' },
    { from: 'confirm', to: 'persist' }
  ]
}

export const usageArchitectureEn: ArchitectureSpec = {
  title: 'What you see',
  nodes: [
    { id: 'user', label: 'User request', kind: 'client' },
    { id: 'ui', label: 'Crescent workbench', kind: 'frontend' },
    { id: 'terminal', label: 'Local / SSH terminal', kind: 'ingress' },
    { id: 'agent', label: 'AI Agent Core', kind: 'service' },
    { id: 'audit', label: 'Command review', kind: 'auth' },
    { id: 'tools', label: 'Tool runtime', kind: 'service' },
    { id: 'files', label: 'read / write / edit', kind: 'data' },
    { id: 'bash', label: 'bash (visible)', kind: 'service' },
    { id: 'subterm', label: 'open_subterminal', kind: 'queue' },
    { id: 'wiki', label: 'Local knowledge base', kind: 'data' }
  ],
  edges: [
    { from: 'user', to: 'ui' },
    { from: 'ui', to: 'terminal' },
    { from: 'ui', to: 'agent' },
    { from: 'agent', to: 'audit' },
    { from: 'audit', to: 'terminal' },
    { from: 'agent', to: 'tools' },
    { from: 'tools', to: 'files' },
    { from: 'tools', to: 'bash' },
    { from: 'tools', to: 'subterm' },
    { from: 'tools', to: 'wiki' },
    { from: 'wiki', to: 'agent' },
    { from: 'terminal', to: 'agent' }
  ]
}

export const systemArchitectureEn: ArchitectureSpec = {
  title: 'System architecture',
  nodes: [
    { id: 'workbench', label: 'Workbench', kind: 'frontend', group: 'renderer' },
    { id: 'bridge', label: 'window.api', kind: 'ingress', group: 'preload' },
    { id: 'host', label: 'Agent host', kind: 'service', group: 'main' },
    { id: 'terminal', label: 'Terminal and SSH', kind: 'ingress', group: 'main' },
    { id: 'review', label: 'Command review', kind: 'auth', group: 'main' },
    { id: 'skills', label: 'Skills', kind: 'service', group: 'main' },
    { id: 'wiki', label: 'Knowledge base', kind: 'data', group: 'main' },
    { id: 'config', label: 'Local config', kind: 'external', group: 'main' },
    { id: 'session', label: 'Agent session', kind: 'service', group: 'pi' },
    { id: 'workspace', label: 'Workspace', kind: 'data', group: 'disk' },
    { id: 'skillDir', label: 'skills', kind: 'data', group: 'disk' },
    { id: 'wikiDir', label: 'wiki', kind: 'data', group: 'disk' },
    { id: 'connections', label: 'Saved connections', kind: 'external', group: 'disk' }
  ],
  edges: [
    { from: 'workbench', to: 'bridge' },
    { from: 'bridge', to: 'host' },
    { from: 'host', to: 'session' },
    { from: 'session', to: 'review' },
    { from: 'review', to: 'terminal' },
    { from: 'session', to: 'skills' },
    { from: 'session', to: 'wiki' },
    { from: 'terminal', to: 'session' },
    { from: 'skills', to: 'skillDir' },
    { from: 'wiki', to: 'wikiDir' },
    { from: 'host', to: 'config' },
    { from: 'config', to: 'connections' },
    { from: 'host', to: 'workspace' }
  ],
  groups: [
    { id: 'renderer', label: 'Renderer', kind: 'frontend' },
    { id: 'preload', label: 'Preload', kind: 'ingress' },
    { id: 'main', label: 'Main', kind: 'service' },
    { id: 'pi', label: 'Pi', kind: 'service' },
    { id: 'disk', label: '~/.crescent', kind: 'data' }
  ]
}

export const workflowArchitectureEn: ArchitectureSpec = {
  title: 'Main workflow',
  nodes: [
    { id: 'request', label: 'User request', kind: 'client' },
    { id: 'context', label: 'Assemble context', kind: 'frontend' },
    { id: 'choose', label: 'Choose a tool', kind: 'service' },
    { id: 'bash', label: 'bash', kind: 'service' },
    { id: 'other', label: 'Files / subterminal / subagent', kind: 'queue' },
    { id: 'capture', label: 'create-skill / create-sop', kind: 'auth' },
    { id: 'review', label: 'Command review', kind: 'auth' },
    { id: 'visible', label: 'Visible terminal', kind: 'ingress' },
    { id: 'output', label: 'Output to session', kind: 'service' },
    { id: 'done', label: 'Conclusion', kind: 'frontend' },
    { id: 'confirm', label: 'Operator confirms', kind: 'client' },
    { id: 'persist', label: 'Write Skill or wiki', kind: 'data' }
  ],
  edges: [
    { from: 'request', to: 'context' },
    { from: 'context', to: 'choose' },
    { from: 'choose', to: 'bash' },
    { from: 'choose', to: 'other' },
    { from: 'choose', to: 'capture' },
    { from: 'bash', to: 'review' },
    { from: 'review', to: 'visible' },
    { from: 'visible', to: 'output' },
    { from: 'other', to: 'output' },
    { from: 'output', to: 'choose', label: 'Keep checking', style: 'dashed' },
    { from: 'output', to: 'done', label: 'Conclude' },
    { from: 'capture', to: 'confirm' },
    { from: 'confirm', to: 'persist' }
  ]
}

// --- Guide flow diagrams (replaces former Mermaid fences) ---

export const toolsArchitectureZh: ArchitectureSpec = {
  title: '流程',
  nodes: [
    { id: 'tool', label: 'Agent 工具', kind: 'service' },
    { id: 'files', label: 'read / write / edit', kind: 'data' },
    { id: 'bash', label: 'bash', kind: 'service' },
    { id: 'subterm', label: 'open_subterminal', kind: 'queue' },
    { id: 'subagent', label: 'subagent', kind: 'queue' },
    { id: 'capture', label: 'create-skill / create-sop', kind: 'auth' },
    { id: 'workspace', label: 'Agent 工作区', kind: 'data' },
    { id: 'review', label: '命令审核', kind: 'auth' },
    { id: 'terminal', label: '可见终端', kind: 'ingress' },
    { id: 'pane', label: '停靠窗格', kind: 'ingress' },
    { id: 'dialog', label: '确认对话框', kind: 'client' }
  ],
  edges: [
    { from: 'tool', to: 'files' },
    { from: 'tool', to: 'bash' },
    { from: 'tool', to: 'subterm' },
    { from: 'tool', to: 'subagent' },
    { from: 'tool', to: 'capture' },
    { from: 'files', to: 'workspace' },
    { from: 'bash', to: 'review' },
    { from: 'review', to: 'terminal' },
    { from: 'subterm', to: 'pane' },
    { from: 'subagent', to: 'pane' },
    { from: 'capture', to: 'dialog' }
  ]
}

export const toolsArchitectureEn: ArchitectureSpec = {
  title: 'Flow',
  nodes: [
    { id: 'tool', label: 'Agent tool', kind: 'service' },
    { id: 'files', label: 'read / write / edit', kind: 'data' },
    { id: 'bash', label: 'bash', kind: 'service' },
    { id: 'subterm', label: 'open_subterminal', kind: 'queue' },
    { id: 'subagent', label: 'subagent', kind: 'queue' },
    { id: 'capture', label: 'create-skill / create-sop', kind: 'auth' },
    { id: 'workspace', label: 'Agent workspace', kind: 'data' },
    { id: 'review', label: 'Command review', kind: 'auth' },
    { id: 'terminal', label: 'Visible terminal', kind: 'ingress' },
    { id: 'pane', label: 'Docked pane', kind: 'ingress' },
    { id: 'dialog', label: 'Confirm dialog', kind: 'client' }
  ],
  edges: [
    { from: 'tool', to: 'files' },
    { from: 'tool', to: 'bash' },
    { from: 'tool', to: 'subterm' },
    { from: 'tool', to: 'subagent' },
    { from: 'tool', to: 'capture' },
    { from: 'files', to: 'workspace' },
    { from: 'bash', to: 'review' },
    { from: 'review', to: 'terminal' },
    { from: 'subterm', to: 'pane' },
    { from: 'subagent', to: 'pane' },
    { from: 'capture', to: 'dialog' }
  ]
}

export const subagentsArchitectureZh: ArchitectureSpec = {
  title: '流程',
  nodes: [
    { id: 'need', label: '需要另一上下文', kind: 'client' },
    { id: 'kind', label: '哪条路径', kind: 'auth' },
    { id: 'open', label: 'open_subterminal', kind: 'queue' },
    { id: 'local', label: 'mode=local', kind: 'ingress' },
    { id: 'ssh', label: 'mode=ssh 且另一条 connectionId', kind: 'external' },
    { id: 'sub', label: 'subagent', kind: 'service' },
    { id: 'pane', label: '独占停靠终端', kind: 'ingress' },
    { id: 'readers', label: '只读角色可并行，最多 3 个', kind: 'frontend' },
    { id: 'limit', label: '不能再派生子代理或沉淀', kind: 'auth' }
  ],
  edges: [
    { from: 'need', to: 'kind' },
    { from: 'kind', to: 'open', label: '只加窗格' },
    { from: 'open', to: 'local' },
    { from: 'open', to: 'ssh' },
    { from: 'kind', to: 'sub', label: '旁路采集' },
    { from: 'sub', to: 'pane' },
    { from: 'pane', to: 'readers' },
    { from: 'sub', to: 'limit' }
  ]
}

export const subagentsArchitectureEn: ArchitectureSpec = {
  title: 'Flow',
  nodes: [
    { id: 'need', label: 'Need another context', kind: 'client' },
    { id: 'kind', label: 'Which path', kind: 'auth' },
    { id: 'open', label: 'open_subterminal', kind: 'queue' },
    { id: 'local', label: 'mode=local', kind: 'ingress' },
    { id: 'ssh', label: 'mode=ssh with another connectionId', kind: 'external' },
    { id: 'sub', label: 'subagent', kind: 'service' },
    { id: 'pane', label: 'Exclusive docked terminal', kind: 'ingress' },
    { id: 'readers', label: 'Read-only profiles in parallel, at most 3', kind: 'frontend' },
    { id: 'limit', label: 'Cannot spawn a child or capture', kind: 'auth' }
  ],
  edges: [
    { from: 'need', to: 'kind' },
    { from: 'kind', to: 'open', label: 'Extra pane only' },
    { from: 'open', to: 'local' },
    { from: 'open', to: 'ssh' },
    { from: 'kind', to: 'sub', label: 'Auxiliary gather' },
    { from: 'sub', to: 'pane' },
    { from: 'pane', to: 'readers' },
    { from: 'sub', to: 'limit' }
  ]
}

export const historyArchitectureZh: ArchitectureSpec = {
  title: '流程',
  nodes: [
    { id: 'open', label: '打开历史会话', kind: 'client' },
    { id: 'chat', label: '恢复对话', kind: 'frontend' },
    { id: 'linked', label: '关联了 SSH', kind: 'auth' },
    { id: 'done', label: '只恢复对话', kind: 'service' },
    { id: 'exists', label: '连接仍在', kind: 'auth' },
    { id: 'reconnect', label: '按当前保存的配置重连', kind: 'ingress' },
    { id: 'manual', label: '不能自动重连', kind: 'external' }
  ],
  edges: [
    { from: 'open', to: 'chat' },
    { from: 'chat', to: 'linked' },
    { from: 'linked', to: 'done', label: '否' },
    { from: 'linked', to: 'exists', label: '是' },
    { from: 'exists', to: 'reconnect', label: '是' },
    { from: 'exists', to: 'manual', label: '否' }
  ]
}

export const historyArchitectureEn: ArchitectureSpec = {
  title: 'Flow',
  nodes: [
    { id: 'open', label: 'Open a past session', kind: 'client' },
    { id: 'chat', label: 'Restore the conversation', kind: 'frontend' },
    { id: 'linked', label: 'Tied to SSH', kind: 'auth' },
    { id: 'done', label: 'Conversation only', kind: 'service' },
    { id: 'exists', label: 'Connection still saved', kind: 'auth' },
    { id: 'reconnect', label: 'Reconnect with the config saved now', kind: 'ingress' },
    { id: 'manual', label: 'Cannot reconnect automatically', kind: 'external' }
  ],
  edges: [
    { from: 'open', to: 'chat' },
    { from: 'chat', to: 'linked' },
    { from: 'linked', to: 'done', label: 'No' },
    { from: 'linked', to: 'exists', label: 'Yes' },
    { from: 'exists', to: 'reconnect', label: 'Yes' },
    { from: 'exists', to: 'manual', label: 'No' }
  ]
}

export const skillsArchitectureZh: ArchitectureSpec = {
  title: '流程',
  nodes: [
    { id: 'call', label: 'create-skill 或 create-sop', kind: 'service' },
    { id: 'request', label: '只发出草稿请求', kind: 'frontend' },
    { id: 'draft', label: '后台根据会话生成', kind: 'queue' },
    { id: 'pending', label: '确认前不落盘', kind: 'auth' },
    { id: 'confirm', label: '操作者确认', kind: 'auth' },
    { id: 'write', label: '写入 Skill 目录或 wiki', kind: 'data' },
    { id: 'stop', label: '不写入', kind: 'external' }
  ],
  edges: [
    { from: 'call', to: 'request' },
    { from: 'request', to: 'draft' },
    { from: 'draft', to: 'pending' },
    { from: 'pending', to: 'confirm' },
    { from: 'confirm', to: 'write', label: '确认' },
    { from: 'confirm', to: 'stop', label: '取消' }
  ]
}

export const skillsArchitectureEn: ArchitectureSpec = {
  title: 'Flow',
  nodes: [
    { id: 'call', label: 'create-skill or create-sop', kind: 'service' },
    { id: 'request', label: 'Request a draft only', kind: 'frontend' },
    { id: 'draft', label: 'Draft from the session in the background', kind: 'queue' },
    { id: 'pending', label: 'Nothing is written before confirm', kind: 'auth' },
    { id: 'confirm', label: 'Operator confirms', kind: 'auth' },
    { id: 'write', label: 'Write the Skill directory or wiki', kind: 'data' },
    { id: 'stop', label: 'Write nothing', kind: 'external' }
  ],
  edges: [
    { from: 'call', to: 'request' },
    { from: 'request', to: 'draft' },
    { from: 'draft', to: 'pending' },
    { from: 'pending', to: 'confirm' },
    { from: 'confirm', to: 'write', label: 'Confirm' },
    { from: 'confirm', to: 'stop', label: 'Cancel' }
  ]
}

export const sshArchitectureZh: ArchitectureSpec = {
  title: '流程',
  nodes: [
    { id: 'pick', label: '选择本地或已保存连接', kind: 'client' },
    { id: 'open', label: 'Main 打开 PTY 或 SSH', kind: 'ingress' },
    { id: 'login', label: '登录动作逐行送入', kind: 'auth' },
    { id: 'site', label: 'Agent 以当前会话为现场', kind: 'service' },
    { id: 'other', label: '另一台主机', kind: 'external' },
    { id: 'sub', label: 'open_subterminal', kind: 'queue' },
    { id: 'otherId', label: '另一条已保存的 connectionId', kind: 'data' }
  ],
  edges: [
    { from: 'pick', to: 'open' },
    { from: 'open', to: 'login' },
    { from: 'login', to: 'site' },
    { from: 'other', to: 'sub' },
    { from: 'sub', to: 'otherId' }
  ]
}

export const sshArchitectureEn: ArchitectureSpec = {
  title: 'Flow',
  nodes: [
    { id: 'pick', label: 'Select local or a saved connection', kind: 'client' },
    { id: 'open', label: 'Main opens a PTY or SSH', kind: 'ingress' },
    { id: 'login', label: 'Login actions typed line by line', kind: 'auth' },
    { id: 'site', label: 'Agent uses this session as the worksite', kind: 'service' },
    { id: 'other', label: 'Another host', kind: 'external' },
    { id: 'sub', label: 'open_subterminal', kind: 'queue' },
    { id: 'otherId', label: 'A different saved connectionId', kind: 'data' }
  ],
  edges: [
    { from: 'pick', to: 'open' },
    { from: 'open', to: 'login' },
    { from: 'login', to: 'site' },
    { from: 'other', to: 'sub' },
    { from: 'sub', to: 'otherId' }
  ]
}

export const commandReviewArchitectureZh: ArchitectureSpec = {
  title: '流程',
  nodes: [
    { id: 'command', label: 'bash 命令', kind: 'service' },
    { id: 'destructive', label: '破坏性写操作', kind: 'auth' },
    { id: 'high', label: '高风险', kind: 'auth' },
    { id: 'allowlist', label: '白名单命中', kind: 'auth' },
    { id: 'allow', label: '放行', kind: 'frontend' },
    { id: 'readonly', label: '静态只读', kind: 'auth' },
    { id: 'model', label: '审核模型', kind: 'service' },
    { id: 'low', label: '低风险', kind: 'frontend' },
    { id: 'confirm', label: '操作者确认', kind: 'client' },
    { id: 'run', label: '写入可见终端', kind: 'ingress' },
    { id: 'stop', label: '不执行', kind: 'external' }
  ],
  edges: [
    { from: 'command', to: 'destructive' },
    { from: 'destructive', to: 'high', label: '是' },
    { from: 'destructive', to: 'allowlist', label: '否' },
    { from: 'allowlist', to: 'allow', label: '是' },
    { from: 'allowlist', to: 'readonly', label: '否' },
    { from: 'readonly', to: 'allow', label: '是' },
    { from: 'readonly', to: 'model', label: '否' },
    { from: 'model', to: 'low' },
    { from: 'model', to: 'high' },
    { from: 'low', to: 'allow' },
    { from: 'high', to: 'confirm' },
    { from: 'confirm', to: 'run', label: '批准' },
    { from: 'confirm', to: 'stop', label: '拒绝、超时或会话关闭' },
    { from: 'allow', to: 'run' }
  ]
}

export const commandReviewArchitectureEn: ArchitectureSpec = {
  title: 'Flow',
  nodes: [
    { id: 'command', label: 'bash command', kind: 'service' },
    { id: 'destructive', label: 'Mutating write', kind: 'auth' },
    { id: 'high', label: 'High risk', kind: 'auth' },
    { id: 'allowlist', label: 'Allowlist match', kind: 'auth' },
    { id: 'allow', label: 'Allow', kind: 'frontend' },
    { id: 'readonly', label: 'Statically read-only', kind: 'auth' },
    { id: 'model', label: 'Review model', kind: 'service' },
    { id: 'low', label: 'Low risk', kind: 'frontend' },
    { id: 'confirm', label: 'Operator confirms', kind: 'client' },
    { id: 'run', label: 'Write into the visible terminal', kind: 'ingress' },
    { id: 'stop', label: 'Do not run', kind: 'external' }
  ],
  edges: [
    { from: 'command', to: 'destructive' },
    { from: 'destructive', to: 'high', label: 'Yes' },
    { from: 'destructive', to: 'allowlist', label: 'No' },
    { from: 'allowlist', to: 'allow', label: 'Yes' },
    { from: 'allowlist', to: 'readonly', label: 'No' },
    { from: 'readonly', to: 'allow', label: 'Yes' },
    { from: 'readonly', to: 'model', label: 'No' },
    { from: 'model', to: 'low' },
    { from: 'model', to: 'high' },
    { from: 'low', to: 'allow' },
    { from: 'high', to: 'confirm' },
    { from: 'confirm', to: 'run', label: 'Approve' },
    { from: 'confirm', to: 'stop', label: 'Reject, time out, or session closed' },
    { from: 'allow', to: 'run' }
  ]
}

export const terminalArchitectureZh: ArchitectureSpec = {
  title: '流程',
  nodes: [
    { id: 'goal', label: '理解目标', kind: 'client' },
    { id: 'site', label: '查看当前终端现场', kind: 'frontend' },
    { id: 'command', label: '执行一条命令', kind: 'service' },
    { id: 'review', label: '命令审核', kind: 'auth' },
    { id: 'output', label: '阅读真实输出', kind: 'ingress' },
    { id: 'more', label: '继续检查', kind: 'service' },
    { id: 'fix', label: '应用修复', kind: 'queue' },
    { id: 'summary', label: '给出结论', kind: 'frontend' },
    { id: 'sub', label: '另一上下文', kind: 'external' },
    { id: 'dock', label: 'open_subterminal', kind: 'queue' }
  ],
  edges: [
    { from: 'goal', to: 'site' },
    { from: 'site', to: 'command' },
    { from: 'command', to: 'review' },
    { from: 'review', to: 'output' },
    { from: 'output', to: 'more' },
    { from: 'output', to: 'fix' },
    { from: 'output', to: 'summary' },
    { from: 'site', to: 'sub' },
    { from: 'sub', to: 'dock' }
  ]
}

export const terminalArchitectureEn: ArchitectureSpec = {
  title: 'Flow',
  nodes: [
    { id: 'goal', label: 'Understand the goal', kind: 'client' },
    { id: 'site', label: 'Read the current terminal', kind: 'frontend' },
    { id: 'command', label: 'Run one command', kind: 'service' },
    { id: 'review', label: 'Command review', kind: 'auth' },
    { id: 'output', label: 'Read the real output', kind: 'ingress' },
    { id: 'more', label: 'Keep checking', kind: 'service' },
    { id: 'fix', label: 'Apply a fix', kind: 'queue' },
    { id: 'summary', label: 'Write the conclusion', kind: 'frontend' },
    { id: 'sub', label: 'Another context', kind: 'external' },
    { id: 'dock', label: 'open_subterminal', kind: 'queue' }
  ],
  edges: [
    { from: 'goal', to: 'site' },
    { from: 'site', to: 'command' },
    { from: 'command', to: 'review' },
    { from: 'review', to: 'output' },
    { from: 'output', to: 'more' },
    { from: 'output', to: 'fix' },
    { from: 'output', to: 'summary' },
    { from: 'site', to: 'sub' },
    { from: 'sub', to: 'dock' }
  ]
}

/** All named presets used by ArchitectureDiagram (architecture + guide pages). */
export const architectureDiagramPresets: Record<string, ArchitectureSpec> = {
  'usage-zh': usageArchitectureZh,
  'system-zh': systemArchitectureZh,
  'workflow-zh': workflowArchitectureZh,
  'usage-en': usageArchitectureEn,
  'system-en': systemArchitectureEn,
  'workflow-en': workflowArchitectureEn,
  'tools-zh': toolsArchitectureZh,
  'tools-en': toolsArchitectureEn,
  'subagents-zh': subagentsArchitectureZh,
  'subagents-en': subagentsArchitectureEn,
  'history-zh': historyArchitectureZh,
  'history-en': historyArchitectureEn,
  'skills-zh': skillsArchitectureZh,
  'skills-en': skillsArchitectureEn,
  'ssh-zh': sshArchitectureZh,
  'ssh-en': sshArchitectureEn,
  'command-review-zh': commandReviewArchitectureZh,
  'command-review-en': commandReviewArchitectureEn,
  'terminal-zh': terminalArchitectureZh,
  'terminal-en': terminalArchitectureEn
}

