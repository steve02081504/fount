/**
 * 【文件】src/stream/pacedStream.mjs
 * 【职责】在无真实 token 流时，按加权字符长度与上次 push 间隔模拟「打字机」节奏，将整段文本拆块回调 onChunk。
 * 【原理】computeWeightedLength 对 CJK 计 2、其余 1；push 将文本按行分配 generationTimeMs，每行再按权重切 numChunks 个 setTimeout；generation 自增可 cancel 丢弃未触发定时器；支持 AbortSignal 中止。
 * 【数据结构】createPacedFakeStream 返回 `{ push, cancel }`、内部 generation/lastCallTime/pending。
 * 【消费者】仅 ideIntegration ACP（经 lineBasedStream）；与 Chat charPreviewStream 无关。
 */
/**
 * @param {string} char 单字符
 * @returns {number} 加权长度
 */
function getCharWeight(char) {
	return /\p{Unified_Ideograph}/u.test(char) ? 2 : 1
}

/**
 * @param {string} str 字符串
 * @returns {number} 加权长度
 */
export function computeWeightedLength(str) {
	let weight = 0
	for (const char of str) weight += getCharWeight(char)
	return weight
}

/**
 * @param {string} line 行文本
 * @param {number} numChunks 块数
 * @returns {string[]} 文本块
 */
function chunkLineByWeightFixed(line, numChunks) {
	const total = computeWeightedLength(line)
	if (!total || numChunks <= 1) return line ? [line] : []
	const chars = [...line]
	const targetPerChunk = total / numChunks
	const chunks = []
	let chunkStart = 0
	let accumulated = 0
	for (let index = 0; index < chars.length; index++) {
		accumulated += getCharWeight(chars[index])
		if (accumulated >= targetPerChunk - 0.001 && chunkStart < chars.length) {
			chunks.push(chars.slice(chunkStart, index + 1).join(''))
			chunkStart = index + 1
			accumulated = 0
		}
	}
	if (chunkStart < chars.length) chunks.push(chars.slice(chunkStart).join(''))
	return chunks.filter(Boolean)
}

/**
 * 按时间节奏的假流式推流（无真实 token 流时使用）。
 * @param {object} options 配置
 * @param {(text: string) => void} options.onChunk 每块文本回调
 * @param {AbortSignal} [options.signal] 中止信号
 * @returns {{ push: (text: string) => Promise<void>, cancel: () => void }} 推流控制
 */
export function createPacedFakeStream(options) {
	const { onChunk, signal } = options
	let lastCallTime = 0
	let pending = Promise.resolve()
	let generation = 0

	/**
	 * @param {string} text 待推流文本
	 * @param {number} generationTimeMs 本批生成耗时（毫秒）
	 * @returns {Promise<void>}
	 */
	function runBatch(text, generationTimeMs) {
		const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
		return new Promise(resolve => {
			if (!lines.length) return resolve()
			const thisGeneration = generation
			const totalWeight = lines.reduce((sum, line) => sum + computeWeightedLength(line), 0)
			const timeouts = []

			/**
			 * @param {number} lineIndex 当前行下标
			 * @returns {void}
			 */
			function scheduleLine(lineIndex) {
				if (lineIndex >= lines.length) return resolve()
				if (generation !== thisGeneration) return
				const line = lines[lineIndex]
				const weight = computeWeightedLength(line)
				const lineDuration = totalWeight > 0 ? generationTimeMs * (weight / totalWeight) : generationTimeMs
				const numChunks = Math.max(1, Math.ceil(weight / 4))
				const chunks = chunkLineByWeightFixed(line, numChunks)
				if (!chunks.length) {
					onChunk('\n')
					return scheduleLine(lineIndex + 1)
				}
				for (const [chunkIndex, chunk] of chunks.entries()) 
					timeouts.push(setTimeout(() => {
						if (signal?.aborted || generation !== thisGeneration) return
						onChunk(chunk)
					}, (chunkIndex / chunks.length) * lineDuration))
				
				timeouts.push(setTimeout(() => {
					if (signal?.aborted || generation !== thisGeneration) return
					onChunk('\n')
					scheduleLine(lineIndex + 1)
				}, lineDuration))
			}

			scheduleLine(0)
			signal?.addEventListener('abort', () => timeouts.forEach(id => clearTimeout(id)), { once: true })
		})
	}

	/**
	 * @param {string} text 待推流文本
	 * @returns {Promise<void>}
	 */
	function push(text) {
		if (!text) return Promise.resolve()
		const callTime = Date.now()
		const generationTimeMs = lastCallTime > 0
			? callTime - lastCallTime
			: computeWeightedLength(text) * 10
		lastCallTime = callTime
		pending = pending.then(() => runBatch(text, generationTimeMs))
		return pending
	}

	/** @returns {void} */
	function cancel() {
		generation++
		lastCallTime = Date.now()
	}

	return { push, cancel }
}
