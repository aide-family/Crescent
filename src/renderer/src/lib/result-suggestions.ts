/**
 * Extract actionable suggestion lines from agent result markdown.
 * Looks for sections titled 修复建议 / 建议 / Recommendations.
 */
export function extractResultSuggestions(resultMarkdown: string): string[] {
  const text = resultMarkdown.trim()
  if (!text) return []

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

    // Leaving the suggestions section when another major heading appears
    if (inSection && /^(#{1,6}\s+|(\*\*)?(❌|✅|概览|总体评价|异常服务|健康摘要))/.test(line)) {
      break
    }
    if (inSection && /^#{1,6}\s+/.test(line)) {
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
