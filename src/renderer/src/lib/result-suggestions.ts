/**
 * Extract actionable suggestion lines from agent result markdown.
 * Looks for sections titled 修复建议 / 建议 / Recommendations.
 */
export function extractResultSuggestions(resultMarkdown: string): string[] {
  const text = resultMarkdown
    .replaceAll('###CRES_BATCH_SEP###', '')
    .replace(/\[Crescent batch: \d+ readonly commands\]/g, '')
    .replace(/^--- command \d+\/\d+: .+ ---$/gm, '')
    .trim()
  if (!text) return []

  // Connection clarify prompts are answered via ConnectionClarifyCard, not inject-suggestions.
  if (isConnectionClarifyPrompt(text)) return []

  const lines = text.split(/\r?\n/)
  const heading =
    /^(#{1,6}\s*)?(\*\*)?(🔧\s*)?(修复建议|建议|Recommendations|Suggested\s+fixes?)(\*\*)?\s*$/i

  let inSection = false
  const items: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (inSection && items.length > 0) {
        // blank line inside section: keep going unless next is new heading
      }
      continue
    }

    if (heading.test(line) || /\*\*🔧\s*修复建议\*\*/.test(line) || /\*\*修复建议\*\*/.test(line)) {
      inSection = true
      continue
    }

    // Leaving the suggestions section when another major heading appears.
    // 总览 / 分项 / 总结 follow 修复建议 in the health-report skeleton.
    if (inSection && endsSuggestionSection(line)) {
      break
    }

    if (!inSection) continue

    const numbered = line.match(/^\d+[.)、]\s*(.+)$/)
    if (numbered) {
      items.push(numbered[1].trim())
      continue
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/)
    if (bullet) {
      items.push(bullet[1].trim())
    }
  }

  // Fallback: if no titled section, take trailing numbered list (last contiguous block)
  if (items.length === 0) {
    const trailing: string[] = []
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      const numbered = line.match(/^\d+[.)、]\s*(.+)$/)
      if (numbered) {
        trailing.unshift(numbered[1].trim())
        continue
      }
      if (trailing.length > 0) break
    }
    return trailing
  }

  return items
}

const SUGGESTION_SECTION_END =
  /^(?:#{1,6}\s+|(?:\*\*)?(?:❌|✅)?\s*)(?:总览|分项|总结|概览|总体评价|异常与风险|异常服务|分域健康|资源与容量|健康摘要)/

function endsSuggestionSection(line: string): boolean {
  if (/^#{1,6}\s+/.test(line)) return true
  if (/^(?:\*\*)?(?:❌|✅)/.test(line)) return true
  return SUGGESTION_SECTION_END.test(line)
}

function isConnectionClarifyPrompt(text: string): boolean {
  return /请选择要连接的目标|Choose a connection target|reply with (?:a )?number or name|回复编号或名称/i.test(
    text
  )
}
