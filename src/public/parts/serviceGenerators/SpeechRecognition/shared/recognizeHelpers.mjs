/**
 * Recognize 选项解析与批式攒包辅助。
 */

/**
 * 校验并展开 Recognize 输入：要么走 feed，要么把 audio 转成单次 send+end。
 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
 * @param {{
 *   onSend: (chunk: Uint8Array, isLast: boolean) => Promise<void>,
 *   onEnd?: () => Promise<void>,
 * }} handlers 发送回调；若 onSend 的 isLast 已处理收尾则可省略 onEnd
 * @returns {Promise<void>}
 */
export async function runRecognizeInput(options, handlers) {
	const hasAudio = !!options.audio?.buffer
	const hasFeed = typeof options.feed === 'function'
	if (hasAudio === hasFeed)
		throw new Error('Recognize requires exactly one of audio or feed')

	if (options.signal?.aborted)
		throw options.signal.reason instanceof Error ? options.signal.reason : new Error('aborted')

	/**
	 * @param {AbortSignal} [signal] 中止信号
	 * @returns {void}
	 */
	const throwIfAborted = (signal) => {
		if (signal?.aborted)
			throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
	}

	if (hasAudio) {
		throwIfAborted(options.signal)
		await handlers.onSend(options.audio.buffer, true)
		await handlers.onEnd?.()
		return
	}

	let ended = false
	await options.feed({
		/**
		 * @param {Uint8Array} chunk 音频帧
		 * @returns {Promise<void>}
		 */
		send: async (chunk) => {
			throwIfAborted(options.signal)
			if (ended) throw new Error('Recognize feed already ended')
			await handlers.onSend(chunk, false)
		},
		/**
		 * @returns {Promise<void>}
		 */
		end: async () => {
			throwIfAborted(options.signal)
			if (ended) return
			ended = true
			await handlers.onSend(new Uint8Array(0), true)
			await handlers.onEnd?.()
		},
	})
	if (!ended) {
		ended = true
		await handlers.onSend(new Uint8Array(0), true)
		await handlers.onEnd?.()
	}
}

/**
 * 批式源：攒齐全部音频后再调用 transcribe。
 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
 * @param {(pcm: Uint8Array, meta: { mime_type?: string, name?: string }) => Promise<string>} transcribe 转写
 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
 */
export async function recognizeByBuffering(options, transcribe) {
	/** @type {Uint8Array[]} */
	const chunks = []
	await runRecognizeInput(options, {
		/**
		 * @param {Uint8Array} chunk 片段
		 * @returns {Promise<void>}
		 */
		onSend: async (chunk) => {
			if (chunk.byteLength) chunks.push(chunk)
		},
	})
	const { concatUint8 } = await import('./pcm.mjs')
	const finalText = String(await transcribe(concatUint8(chunks), {
		mime_type: options.audio?.mime_type,
		name: options.audio?.name,
	}) || '')
	options.onResult?.({ text: finalText, isFinal: true })
	return { text: finalText, language: options.language }
}

/**
 * 按 info 模板套 name/provider。
 * @param {Record<string, object>} productInfo 产品信息
 * @param {{ name?: string, provider?: string }} config 配置
 * @returns {Record<string, object>} info
 */
export function buildSourceInfo(productInfo, config = {}) {
	return Object.fromEntries(Object.entries(structuredClone(productInfo)).map(([locale, localizedInfo]) => {
		localizedInfo.name = config.name || localizedInfo.name
		if (config.provider) localizedInfo.provider = config.provider
		return [locale, localizedInfo]
	}))
}

/**
 * 打开全局 WebSocket。
 * @param {string} url 地址
 * @param {{ binaryType?: BinaryType }} [opts] 选项
 * @returns {Promise<WebSocket>} 连接
 */
export function openWs(url, opts = {}) {
	const ws = new WebSocket(url)
	if (opts.binaryType) ws.binaryType = opts.binaryType
	return new Promise((resolve, reject) => {
		ws.addEventListener('open', () => resolve(ws), { once: true })
		ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true })
	})
}

/**
 * 从 RTASR data 对象抽文本。
 * @param {object} resultData 结果
 * @returns {string} 文本
 */
export function extractRtasrText(resultData) {
	let text = ''
	for (const recognitionResult of resultData?.cn?.st?.rt || [])
		for (const wordSegment of recognitionResult.ws || [])
			for (const candidateWord of wordSegment.cw || [])
				text += candidateWord.w || ''
	return text
}
