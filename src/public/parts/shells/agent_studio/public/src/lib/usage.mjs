/** Studio 的用量统计仅包含仍保留的请求记录。 */
import { mergeUsage } from '/parts/shells:chat/shared/usage.mjs'

/**
 * 仅汇总会话中仍保留的请求用量。
 * @param {object[]} generations 当前会话的生成记录。
 * @returns {object} 合并后的调用明细与总量。
 */
export function summarizeRecordedUsage(generations) {
	return mergeUsage(...(generations || []).flatMap(generation => (generation.requests || []).map(request => request.usage).filter(Boolean)))
}

/**
 * 将用量格式化为紧凑的元信息标签。
 * @param {object} usage 用量汇总。
 * @param {string} locale 显示区域。
 * @param {(key: string, params?: object) => string} translate 翻译函数。
 * @returns {string} token 与已知费用摘要；没有计量时返回空字符串。
 */
export function formatUsage(usage, locale, translate) {
	const total = usage?.total || {}
	const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
	const tokens = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens']
		.filter(key => total[key] != null && Number.isFinite(Number(total[key])))
		.map(key => translate(`agent_studio.usage.${key}`, { count: formatter.format(total[key]) }))
	const costs = Object.entries(total.costs || {}).filter(([, cost]) => Number.isFinite(Number(cost)))
	for (const [currency, cost] of costs) {
		const value = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(cost)
		tokens.push(translate('agent_studio.usage.estimatedCost', { amount: value, currency }))
	}
	return tokens.join(' · ')
}
