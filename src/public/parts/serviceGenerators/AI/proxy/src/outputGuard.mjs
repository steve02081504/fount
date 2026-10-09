/** 检查当前请求的输出重复，检测窗口保持有界。 */

/** 输出退化异常，不能触发端点或来源回退。 */
export class AIOutputDegenerationError extends Error {
	/**
	 * @param {object} evidence 重复度量（`channel` 与检测器给出的字段）。
	 */
	constructor(evidence) {
		super(`Model output contains suspected repetition (${evidence.channel}: ${evidence.kind}).`)
		this.name = 'AIOutputDegenerationError'
		this.code = 'output_degenerated'
		this.evidence = evidence
	}
}

/**
 * 检测短周期、重复段落和编号变化但正文不变的列表。
 * Checks run every 32 normalized characters, independently of transport chunks.
 * @returns {{append: (text: string) => object | undefined, finish: () => object | undefined}} Incremental detector.
 */
export function createRepetitionDetector() {
	let tail = ''
	let pending = ''
	let line = ''
	let lastItem = ''
	let itemCount = 0
	let itemChars = 0
	let detected
	/**
	 * @returns {object | undefined} Measurements of a repeating suffix.
	 */
	function inspectTail() {
		// 短周期要重复很多次才算退化，长周期重复几段就够。
		const maxPeriod = Math.min(512, Math.floor(tail.length / 3))
		for (let period = 1; period <= maxPeriod; period++) {
			const unit = tail.slice(-period)
			if (!unit.trim()) continue
			let repeats = 1
			while (repeats * period < tail.length && tail.slice(-(repeats + 1) * period, -repeats * period) === unit) repeats++
			const repeatedChars = repeats * period
			if (period <= 16 ? repeats >= 12 && repeatedChars >= 96 : repeats >= 3 && repeatedChars >= 240)
				return { kind: 'periodic', period, repeats, repeatedChars }
		}
	}
	/**
	 * @param {string} text New text, not a cumulative snapshot.
	 * @returns {object | undefined} First detected repetition.
	 */
	function append(text) {
		if (detected) return detected
		// Consume in text order so mixed list / periodic signals are chunk-independent.
		for (const char of text) {
			line += char
			if (line.length > 8192) line = line.slice(-4096)
			if (char === '\n') {
				const trimmed = line.trim()
				const item = trimmed.replace(/^[\s*#>•-]*/u, '').match(/^(?:第\s*\d+\s*[^\d\s:：.、)]{0,3}\s*[:：、.]|\d+\s*[.)、:：])\s*(.+)$/u)?.[1]?.replace(/\s+/gu, '')
				line = ''
				if (!item) {
					if (trimmed) { lastItem = ''; itemCount = 0; itemChars = 0 }
				} else {
					itemCount = item === lastItem ? itemCount + 1 : 1
					itemChars = item === lastItem ? itemChars + item.length : item.length
					lastItem = item
					if (itemCount >= 6 && itemChars >= 96) {
						detected = { kind: 'numbered_items', repeats: itemCount, repeatedChars: itemChars }
						return detected
					}
				}
			}
			if (/\s/u.test(char)) continue
			pending += char
			while (pending.length >= 32) {
				tail = (tail + pending.slice(0, 32)).slice(-4096)
				pending = pending.slice(32)
				detected = inspectTail()
				if (detected) return detected
			}
		}
	}
	return {
		append,
		/** @returns {object | undefined} Inspect a final partial interval / list item. */
		finish() {
			if (detected) return detected
			if (line) {
				detected = append('\n')
				if (detected) return detected
			}
			tail = (tail + pending).slice(-4096)
			pending = ''
			return detected = inspectTail()
		},
	}
}

/**
 * 检查原始结果的累计快照，各推理通道独立计数。
 * @returns {{inspect: (result: object, final?: boolean) => void}} Request-local monitor.
 */
export function createOutputGuard() {
	const channels = new Map()
	return {
		/**
		 * @param {object} result Current raw result.
		 * @param {boolean} [final=false] Flush remaining text after completion.
		 * @returns {void}
		 */
		inspect(result, final = false) {
			const texts = {
				content: result.content ?? '',
				reasoning: result.extension?.reasoning_content ?? '',
				...Object.fromEntries((result.extension?.reasoning_summary ?? []).map((text, index) => [`reasoning_summary:${index}`, text])),
			}
			for (const [channel, text] of Object.entries(texts)) {
				let state = channels.get(channel)
				if (!state || text.length < state.length) {
					state = { length: 0, detector: createRepetitionDetector() }
					channels.set(channel, state)
				}
				const evidence = state.detector.append(text.slice(state.length)) ?? (final ? state.detector.finish() : undefined)
				state.length = text.length
				if (evidence) throw new AIOutputDegenerationError({ channel, ...evidence })
			}
		},
	}
}
