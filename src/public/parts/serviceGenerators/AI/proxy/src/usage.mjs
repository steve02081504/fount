import { priceUsage, summarizeUsage } from '../../../../shells/chat/public/shared/usage.mjs'

/** 提供方把明细累计快照拆成多次上报的字段：后续片段只有增量，需要与本调用已收快照合并。 */
const detailFields = ['prompt_tokens_details', 'input_tokens_details', 'completion_tokens_details', 'output_tokens_details']

/**
 * 归一化提供方用量，输入总量包括缓存，输出总量包括推理。
 * @param {object} raw 提供方计量。
 * @param {string} provider 接口类型。
 * @returns {object} 已知计量字段。
 */
export function normalizeUsage(raw, provider) {
	let usage
	switch (provider) {
		case 'anthropic':
			usage = { inputTokens: raw.input_tokens == null ? undefined : raw.input_tokens + (raw.cache_read_input_tokens ?? 0) + (raw.cache_creation_input_tokens ?? 0), cacheReadTokens: raw.cache_read_input_tokens ?? 0, cacheWriteTokens: raw.cache_creation_input_tokens ?? 0, outputTokens: raw.output_tokens }
			break
		case 'gemini':
			usage = { inputTokens: raw.promptTokenCount, cacheReadTokens: raw.cachedContentTokenCount ?? 0, cacheWriteTokens: 0, outputTokens: raw.candidatesTokenCount == null ? undefined : raw.candidatesTokenCount + (raw.thoughtsTokenCount ?? 0), reasoningTokens: raw.thoughtsTokenCount }
			break
		case 'bedrock':
			// Converse inputTokens excludes cached input (AWS prompt-caching guide).
			usage = { inputTokens: raw.inputTokens == null ? undefined : raw.inputTokens + (raw.cacheReadInputTokens ?? 0) + (raw.cacheWriteInputTokens ?? 0), cacheReadTokens: raw.cacheReadInputTokens ?? 0, cacheWriteTokens: raw.cacheWriteInputTokens ?? 0, outputTokens: raw.outputTokens }
			break
		case 'ollama':
			usage = { inputTokens: raw.prompt_eval_count, outputTokens: raw.eval_count, cacheReadTokens: 0, cacheWriteTokens: 0 }
			break
		case 'cohere':
			usage = { inputTokens: raw.inputTokens ?? raw.input_tokens, outputTokens: raw.outputTokens ?? raw.output_tokens }
			break
		default:
			usage = { inputTokens: raw.prompt_tokens ?? raw.input_tokens, cacheReadTokens: raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens, cacheWriteTokens: raw.prompt_tokens_details?.cache_write_tokens ?? raw.input_tokens_details?.cache_write_tokens ?? 0, outputTokens: raw.completion_tokens ?? raw.output_tokens, reasoningTokens: raw.completion_tokens_details?.reasoning_tokens ?? raw.output_tokens_details?.reasoning_tokens }
	}
	return Object.fromEntries(Object.entries(usage).filter(([, value]) => Number.isFinite(value) && value >= 0))
}

/**
 * 为一个回复对象建立用量记录器：流式片段多次上报同一次调用，`record` 合并为一份累计快照，`apply` 才结算并写入
 * `result.extension.usage`（沿用 `base_result` 的回复按调用追加，保留此前轮次的计量）。
 * @param {object} result 回复对象。
 * @param {object} config 源配置。
 * @param {string} provider 接口类型。
 * @returns {{record: (raw: object, model?: string) => void, apply: () => void}} 记录器。
 */
export function createUsageRecorder(result, config, provider = 'openai') {
	const previous = result.extension?.usage?.calls ?? []
	let reported = {}
	let actualModel = config.model
	return {
		/**
		 * 合并一次上报（缺计量的片段直接忽略）。
		 * @param {object} raw 提供方计量。
		 * @param {string} [model] 提供方回报的实际模型。
		 * @returns {void} 无返回值。
		 */
		record(raw, model) {
			actualModel = model ?? actualModel
			if (!raw) return
			const merged = { ...reported, ...raw }
			for (const field of detailFields)
				if (raw[field]) merged[field] = { ...reported[field], ...raw[field] }
			reported = merged
		},
		/**
		 * 结算已记录片段并把该调用挂到回复的累计用量上。
		 * @returns {void} 无返回值。
		 */
		apply() {
			const usage = normalizeUsage(reported, provider)
			if (usage.inputTokens == null && usage.outputTokens == null) return
			result.extension ??= {}
			result.extension.usage = summarizeUsage([...previous, priceUsage({ source: config.name, model: actualModel, purpose: 'reply', ...usage }, config.pricing)])
		},
	}
}
