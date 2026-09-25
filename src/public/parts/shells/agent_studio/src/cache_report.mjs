/**
 * 【文件】src/cache_report.mjs — Agent Studio 提示缓存报告
 * 【职责】给定按时间排序的生成记录，逐请求计算相对上一请求的公共前缀复用率（公共前缀 / 上一请求长度），并标记发生上下文压缩的轮次，输出机器可读报告。
 * 【原理】复用 `public/shared/promptCache.mjs` 的序列化与公共前缀算法；含 `summary` 条目的请求（或紧随其后的请求）不算缓存命中率，避免把压缩造成的下降误判为事故。
 * 【关联】cli.mjs（cache-report 子命令）、generation_history.mjs、public/shared/promptCache.mjs。
 */
import { commonPrefixLength, serializeRequest } from '../public/shared/promptCache.mjs'

/**
 * 判断一次请求快照是否发生（或承接）上下文压缩：任一消息为 `summary` 条目。
 * @param {object} request 请求快照
 * @returns {boolean} 是否压缩相关
 */
function isCompressedRequest(request) {
	return Array.isArray(request?.messages) && request.messages.some(message => message?.type === 'summary')
}

/**
 * 构建提示缓存报告。
 * @param {object[]} records 生成记录（含 `requests`，按时间升序）
 * @param {{ conversationId?: string, threshold?: number }} [options] 选项
 * @returns {{ conversationId: string, threshold: number, minNonCompressedRate: number|null, below: boolean, generations: Array<{id: string, requests: Array<{index: number, rate: number|null, compressed: boolean}>}> }} 报告
 */
export function buildCacheReport(records = [], { conversationId = '', threshold = 0.729 } = {}) {
	let previousPrompt = null
	let previousCompressed = false
	let minNonCompressedRate = null
	const generations = []
	for (const record of records) {
		const requests = Array.isArray(record?.requests) ? record.requests : []
		const rounds = []
		for (const request of requests) {
			const compressed = isCompressedRequest(request)
			const current = serializeRequest(request)
			let rate = null
			// 本轮或上一轮发生压缩时，前缀对比不可比：跳过不计
			if (previousPrompt != null && !compressed && !previousCompressed && previousPrompt.length)
				rate = commonPrefixLength(current, previousPrompt) / previousPrompt.length
			if (rate != null && (minNonCompressedRate == null || rate < minNonCompressedRate))
				minNonCompressedRate = rate
			rounds.push({ index: request.index ?? rounds.length + 1, rate, compressed })
			previousPrompt = current
			previousCompressed = compressed
		}
		generations.push({ id: record?.id ?? '', requests: rounds })
		if (!requests.length) {
			previousPrompt = null
			previousCompressed = false
		}
	}
	return {
		conversationId,
		threshold,
		minNonCompressedRate,
		below: minNonCompressedRate != null && minNonCompressedRate < threshold,
		generations,
	}
}
