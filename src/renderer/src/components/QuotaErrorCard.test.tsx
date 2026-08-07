import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import zhCN from '../i18n/zh-CN'
import { QuotaErrorCard } from './QuotaErrorCard'

describe('QuotaErrorCard', () => {
  it('renders human quota card without raw 429 JSON', () => {
    const t = zhCN
    const message = t.input.modelQuotaExceeded
      .replace('{provider}', 'DeepSeek')
      .replace('{resetHint}', '约 5 分钟后')

    const html = renderToStaticMarkup(
      createElement(QuotaErrorCard, {
        t,
        provider: 'DeepSeek',
        resetHint: '约 5 分钟后',
        message,
        onOpenModelSettings: () => undefined
      })
    )

    expect(html).toContain('data-testid="model-quota-error-card"')
    expect(html).toContain('模型配额已用尽')
    expect(html).toContain('DeepSeek')
    expect(html).toContain('切换模型')
    expect(html).not.toContain('AccountQuotaExceeded')
    expect(html).not.toContain('"type":"Limit"')
    expect(html).not.toContain('429:')
    expect(html).not.toContain('{')
  })
})
