import { describe, expect, it } from 'vitest'

import { dictionaries } from '../i18n'
import { extractResultMarkdown, parseAgentRunMarkdown } from '../lib/agent-run-markdown'

const t = dictionaries['zh-CN']

describe('agent run markdown parsing', () => {
  it('keeps horizontal rules inside the result body', () => {
    const markdown = [
      `**${t.input.actions}**`,
      '',
      '- 开始运行 Agent',
      '',
      `**${t.input.result}**`,
      '',
      '全部证据已收集完毕。下面整理 moon 集群网络架构图。',
      '',
      '---',
      '',
      '## 架构图',
      '',
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '---',
      '',
      `${t.input.elapsed}: 3s`
    ].join('\n')

    expect(extractResultMarkdown(markdown, t)).toContain('## 架构图')
    expect(extractResultMarkdown(markdown, t)).toContain('flowchart TD')
  })

  it('removes loaded MCP catalog noise from action details', () => {
    const markdown = [
      `**${t.input.actions}**`,
      '',
      '- 开始运行 Agent',
      '- Loaded 14 MCP tools.',
      '- 调用工具: mcp_filesystem_read_text_file',
      '',
      '<details>',
      `<summary>${t.input.actionDetailsCompleted}</summary>`,
      '',
      '#### 1. 开始运行 Agent',
      '',
      'ok',
      '',
      '#### 2. Loaded 14 MCP tools.',
      '',
      '**动作意图**',
      'Loaded 14 MCP tools:',
      '- mcp_filesystem_read_text_file · POST mcp://filesystem/read_text_file · Read file',
      '',
      '**原始观察**',
      '```text',
      'Loaded 14 MCP tools:',
      '- mcp_filesystem_read_text_file · POST mcp://filesystem/read_text_file · Read file',
      '```',
      '',
      '#### 3. 调用工具: mcp_filesystem_read_text_file',
      '',
      'Tool: mcp_filesystem_read_text_file',
      '',
      '</details>',
      '',
      `**${t.input.result}**`,
      '',
      'done'
    ].join('\n')

    const parsed = parseAgentRunMarkdown(markdown, t)

    expect(parsed?.actionsMarkdown).not.toContain('Loaded 14 MCP tools')
    expect(parsed?.actionsMarkdown).toContain('调用工具: mcp_filesystem_read_text_file')
  })
})
