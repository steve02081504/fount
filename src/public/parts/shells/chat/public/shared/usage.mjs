const tokenFields = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens']

/**
 * 汇总已记录的调用；未知计量保持缺省，币种分别求和。
 * @param {object[]} calls 调用明细。
 * @returns {{calls: object[], total: object}} 用量。
 */
export function summarizeUsage(calls = []) {
	const total = {}
	for (const call of calls) {
		for (const field of tokenFields)
			if (call[field] != null) total[field] = (total[field] ?? 0) + call[field]
		if (call.cost != null && call.currency) {
			total.costs ??= {}
			total.costs[call.currency] = (total.costs[call.currency] ?? 0) + call.cost
		}
	}
	return { calls, total }
}

/**
 * 合并各自独立的调用集合。
 * @param {...object} usages 用量。
 * @returns {{calls: object[], total: object}} 汇总。
 */
export function mergeUsage(...usages) {
	return summarizeUsage(usages.flatMap(usage => usage?.calls ?? []))
}

/**
 * 按每百万 token 单价计算费用；未知缓存分类或所需价格不计价。
 * @param {object} call 调用。
 * @param {object} pricing 单价及币种。
 * @returns {object} 附有可选费用与价格快照的调用。
 */
export function priceUsage(call, pricing) {
	if (!pricing?.currency || call.inputTokens == null || call.outputTokens == null) return call
	// A uniform input tariff does not require a cache breakdown.
	const read = call.cacheReadTokens ?? (pricing.cacheRead === pricing.input ? 0 : undefined)
	const write = call.cacheWriteTokens ?? (pricing.cacheWrite === pricing.input ? 0 : undefined)
	if (read == null || write == null) return call
	const counts = { input: call.inputTokens - read - write, cacheRead: read, cacheWrite: write, output: call.outputTokens }
	if (Object.entries(counts).some(([key, count]) => !Number.isFinite(count) || count < 0 || (count > 0 && (!Number.isFinite(pricing[key]) || pricing[key] < 0)))) return call
	return { ...call, pricing: { ...pricing }, currency: pricing.currency, cost: Object.entries(counts).reduce((sum, [key, count]) => sum + (count ? count * pricing[key] / 1e6 : 0), 0) }
}
