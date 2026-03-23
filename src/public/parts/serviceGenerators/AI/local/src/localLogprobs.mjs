/**
 * 使用 LlamaContextSequence.controlledEvaluate 收集与 OpenAI chat.completions 兼容的 logprobs。
 * 采用增量评估策略：KV 缓存在整个收集过程中持续复用，时间复杂度从 O(n²) 降至 O(n)。
 * @see https://node-llama-cpp.withcat.ai/guide/low-level-api
 */

/**
 * @param {object} config - 含 prompt_options 的服务配置。
 * @returns {object} 传给 controlledEvaluate generateNext.options 的采样参数。
 */
export function buildSamplingReplayOptions(config) {
	const p = config.prompt_options ?? {}
	const o = {
		temperature: p.temperature,
		minP: p.minP,
		topK: p.topK,
		topP: p.topP,
		seed: p.seed,
		xtc: p.xtc,
	}
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null))
}

/**
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaModel} model - 当前加载的 GGUF 模型。
 * @param {import('npm:node-llama-cpp@3.18.1').Token} selectedToken - 实际被选中的 token id。
 * @param {Map<import('npm:node-llama-cpp@3.18.1').Token, number>} probabilities - 下一 token 的完整概率表。
 * @param {number} topN - 保留的 top 候选条数上限。
 * @returns {{ token: string, logprob: number|null, top_logprobs: Array<{token: string, logprob: number|null}> }} OpenAI 风格的单条 logprob 记录。
 */
function buildLogprobEntry(model, selectedToken, probabilities, topN) {
	const pSel = probabilities.get(selectedToken)
	const logprob = pSel > 0 ? Math.log(pSel) : null
	const top_logprobs = []
	for (const [tok, prob] of probabilities) {
		if (top_logprobs.length >= topN) break
		top_logprobs.push({ token: model.detokenize([tok], true), logprob: prob > 0 ? Math.log(prob) : null })
	}
	const selectedTokenStr = model.detokenize([selectedToken], true)
	return {
		token: selectedTokenStr,
		logprob: logprob ?? top_logprobs.find(l => l.token === selectedTokenStr)?.logprob ?? null,
		top_logprobs,
	}
}

/**
 * 清空 sequence 上下文，将 prefixTokens[0..n-2] 写入 KV 缓存，
 * 返回最后一个前缀 token（作为首次 generateNext 的触发 token）。
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaContextSequence} sequence - 用于重放的上下文序列。
 * @param {import('npm:node-llama-cpp@3.18.1').Token[]} prefixTokens - 回复开始前上下文的 token 序列。
 * @returns {Promise<import('npm:node-llama-cpp@3.18.1').Token|null>} 首次 `generateNext` 的触发 token，无前缀时为 null。
 */
async function resetAndLoadPrefix(sequence, prefixTokens) {
	await sequence.eraseContextTokenRanges([{ start: 0, end: sequence.nextTokenIndex }])
	if (!prefixTokens.length) return null
	if (prefixTokens.length > 1)
		await sequence.controlledEvaluate(prefixTokens.slice(0, -1), {})
	return prefixTokens.at(-1)
}

/**
 * 批量收集 tokens 的 logprobs，单次 controlledEvaluate 批量请求，O(1) 异步往返。
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaModel} model - 当前加载的 GGUF 模型。
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaContextSequence} sequence - 用于重放的上下文序列。
 * @param {import('npm:node-llama-cpp@3.18.1').Token} triggerToken - 序列的起始触发 token。
 * @param {import('npm:node-llama-cpp@3.18.1').Token[]} outTokens - 要收集 logprobs 的 token 序列。
 * @param {number} topN - top_logprobs 条数上限。
 * @param {object} samplingOptions - 传给 `generateNext` 的采样选项。
 * @returns {Promise<(object|null)[]>} 与 outTokens 等长的 logprob 条目数组（无概率时为 null）。
 */
async function evalBatchedLogprobs(model, sequence, triggerToken, outTokens, topN, samplingOptions) {
	if (!outTokens.length) return []
	const batchInput = [triggerToken, ...outTokens.slice(0, -1)]
		.map(t => [t, { generateNext: { probabilities: true, options: samplingOptions } }])
	const batchRes = await sequence.controlledEvaluate(batchInput, {})
	return outTokens.map((outToken, i) => {
		const probs = batchRes[i]?.next?.probabilities ?? null
		return probs?.size ? buildLogprobEntry(model, outToken, probs, topN) : null
	})
}

/**
 * 批量收集回复的 logprobs（非流式），单次 controlledEvaluate 完成所有 token，O(1) 异步往返。
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaModel} model - 当前加载的 GGUF 模型。
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaContextSequence} sequence - 用于重放的上下文序列。
 * @param {import('npm:node-llama-cpp@3.18.1').Token[]} prefixTokens - 回复开始前上下文的 token 序列。
 * @param {import('npm:node-llama-cpp@3.18.1').Token[]} outTokens - 模型回复的 token 序列。
 * @param {number} topN - top_logprobs 条数上限。
 * @param {object} samplingOptions - 传给 `generateNext` 的采样选项。
 * @returns {Promise<{ content: object[], metrics: object }>} logprobs 内容与耗时类指标。
 */
export async function collectLocalLogprobs(model, sequence, prefixTokens, outTokens, topN, samplingOptions) {
	if (!prefixTokens.length || !outTokens.length)
		return { content: [], metrics: { ttftSeconds: 0, timeSeconds: 0, tokensCount: 0, speed: 0 } }

	const triggerToken = await resetAndLoadPrefix(sequence, prefixTokens)
	if (triggerToken == null)
		return { content: [], metrics: { ttftSeconds: 0, timeSeconds: 0, tokensCount: 0, speed: 0 } }

	const startedAt = Date.now()
	const rows = await evalBatchedLogprobs(model, sequence, triggerToken, outTokens, topN, samplingOptions)
	const firstTokenAt = Date.now()

	const content = rows.filter(Boolean)
	const timeSeconds = Math.max(0, (Date.now() - startedAt) / 1000)
	const tokensCount = content.length
	return {
		content,
		metrics: {
			ttftSeconds: Math.max(0, (firstTokenAt - startedAt) / 1000),
			timeSeconds,
			tokensCount,
			speed: timeSeconds > 0 ? tokensCount / timeSeconds : 0,
		},
	}
}

/**
 * 创建流式 logprobs 收集器，首次 collectBatch 前须调用 init。
 * KV 缓存跨 token 持续复用；collectBatch 将同一 chunk 内的所有 token 合并为单次 controlledEvaluate 调用。
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaModel} model - 当前加载的 GGUF 模型。
 * @param {import('npm:node-llama-cpp@3.18.1').LlamaContextSequence} sequence - 用于重放的上下文序列。
 * @param {number} topN - top_logprobs 条数上限。
 * @param {object} samplingOptions - 传给 `generateNext` 的采样选项。
 * @returns {{ isReady: boolean, init: (prefixTokens: import('npm:node-llama-cpp@3.18.1').Token[]) => Promise<void>, collectBatch: (outTokens: import('npm:node-llama-cpp@3.18.1').Token[]) => Promise<(object|null)[]> }} 流式 logprobs 收集器。
 */
export function createStreamingLogprobsCollector(model, sequence, topN, samplingOptions) {
	let triggerToken = null
	return {
		/**
		 * 是否已完成前缀加载并可开始收集。
		 * @returns {boolean} 已就绪时为 true。
		 */
		get isReady() { return triggerToken != null },
		/**
		 * 清空重放序列并写入前缀，准备从指定位置重算概率。
		 * @param {import('npm:node-llama-cpp@3.18.1').Token[]} prefixTokens - 回复开始前上下文的 token 序列。
		 * @returns {Promise<void>}
		 */
		async init(prefixTokens) {
			triggerToken = await resetAndLoadPrefix(sequence, prefixTokens)
		},
		/**
		 * 对一批输出 token 批量收集 logprobs（单次 controlledEvaluate）。
		 * @param {import('npm:node-llama-cpp@3.18.1').Token[]} outTokens - 本 chunk 内新生成的 token id 数组。
		 * @returns {Promise<(object|null)[]>} 与 outTokens 等长的 logprob 条目（无概率时为 null）。
		 */
		async collectBatch(outTokens) {
			if (!outTokens.length || triggerToken == null) return []
			const rows = await evalBatchedLogprobs(model, sequence, triggerToken, outTokens, topN, samplingOptions)
			triggerToken = outTokens.at(-1)
			return rows
		},
	}
}
