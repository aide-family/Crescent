/** Frame prefix for busy-path steer payloads (model-visible, not UI copy). */
export const RUNTIME_SUPPLEMENT_FRAME_PREFIX =
  '[上下文注入] 以下为运行中补充，并入当前任务统一处理；禁止单独总结，全部完成后随最终报告一次性输出：'

/** Hard discipline line appended under system-prompt「叙述纪律」. */
export const RUNTIME_SUPPLEMENT_DISCIPLINE = [
  '运行中补充是上下文注入而非新任务：收到后仅 ≤1 句确认或不予提及；',
  '中间禁止输出完整表格/小结；最终报告在原任务与全部补充完成后仅输出一次，覆盖所有问题。'
].join('')

/** Wrap steer text so runtime supplements are treated as context injection, not new tasks. */
export function wrapSteerSupplementPayload(original: string): string {
  const text = original.trim()
  if (!text) return text
  if (text.startsWith('[上下文注入]')) return text
  return `${RUNTIME_SUPPLEMENT_FRAME_PREFIX}${text}`
}
