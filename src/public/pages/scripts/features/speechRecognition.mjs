/**
 * 前端语音识别：探测配置、整段识别、实时会话（端点由 chat shell 提供）。
 */
import { arrayBufferToBase64 } from '../lib/base64.mjs'
import { getAllDefaultPartsByType, getPartList } from '../endpoints/parts.mjs'

const API_BASE = '/api/parts/shells:chat'
const WS_BASE = '/ws/parts/shells:chat'

const STATUS_CACHE_MS = 30_000
/** @type {{ at: number, configured: boolean } | null} */
let statusCache = null

/**
 * 是否已配置语音识别源（走通用 part 列表 / 默认项）。
 * @returns {Promise<boolean>} 是否配置
 */
export async function hasSpeechRecognitionSource() {
	if (statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.configured
	try {
		const [defaults, list] = await Promise.all([
			getAllDefaultPartsByType('serviceSources/SpeechRecognition'),
			getPartList('serviceSources/SpeechRecognition'),
		])
		const configured = (Array.isArray(defaults) ? defaults.length : 0) > 0
			|| (Array.isArray(list) ? list.length : 0) > 0
		statusCache = { at: Date.now(), configured }
		return configured
	}
	catch {
		statusCache = { at: Date.now(), configured: false }
		return false
	}
}

/**
 * 清除语音识别配置缓存。
 * @returns {void}
 */
export function clearSpeechRecognitionStatusCache() {
	statusCache = null
}

/**
 * 整段音频识别（批便捷路径）。
 * @param {object} options 选项
 * @param {Blob|File|ArrayBuffer|Uint8Array} options.audio 音频
 * @param {string} [options.mime_type] MIME
 * @param {string} [options.name] 文件名
 * @param {string} [options.language] 语言
 * @param {(partial: { text: string, isFinal?: boolean }) => void} [options.onPreview] 增量
 * @returns {Promise<{ text: string, language?: string }>} 结果
 */
export async function recognizeBuffer({
	audio,
	mime_type,
	name,
	language,
	onPreview,
} = {}) {
	let buffer
	let mime = mime_type
	let fileName = name
	if (audio instanceof Blob) {
		buffer = arrayBufferToBase64(await audio.arrayBuffer())
		mime ||= audio.type || 'application/octet-stream'
		if (audio instanceof File) fileName ||= audio.name
	}
	else if (audio instanceof ArrayBuffer)
		buffer = arrayBufferToBase64(audio)
	else if (audio instanceof Uint8Array)
		buffer = arrayBufferToBase64(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength))
	else
		throw new Error('recognizeBuffer: invalid audio')

	const useStream = typeof onPreview === 'function'
	const response = await fetch(`${API_BASE}/speechRecognition/recognize${useStream ? '?stream=ndjson' : ''}`, {
		method: 'POST',
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...useStream ? { Accept: 'application/x-ndjson' } : {},
		},
		body: JSON.stringify({
			buffer,
			mime_type: mime || 'application/octet-stream',
			name: fileName,
			language,
			stream: useStream,
		}),
	})
	if (!response.ok) throw new Error(await response.text())

	if (!useStream) return response.json()

	const reader = response.body?.getReader()
	if (!reader) throw new Error('recognizeBuffer: no response body')
	const decoder = new TextDecoder()
	let pending = ''
	/** @type {{ text: string, language?: string } | null} */
	let finalResult = null
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		pending += decoder.decode(value, { stream: true })
		const lines = pending.split('\n')
		pending = lines.pop() || ''
		for (const line of lines) {
			if (!line.trim()) continue
			const row = JSON.parse(line)
			if (row.type === 'partial') onPreview?.({ text: row.text, isFinal: row.isFinal })
			else if (row.type === 'final') finalResult = { text: row.text, language: row.language }
		}
	}
	if (pending.trim()) {
		const row = JSON.parse(pending)
		if (row.type === 'final') finalResult = { text: row.text, language: row.language }
		else if (row.type === 'partial') onPreview?.({ text: row.text, isFinal: row.isFinal })
	}
	if (!finalResult) throw new Error('recognizeBuffer: missing final result')
	return finalResult
}

/**
 * 打开实时语音识别 WebSocket 会话。
 * @param {object} options 选项
 * @param {string} [options.language] 语言
 * @param {string[]} [options.hotwords] 热词
 * @param {(partial: { text: string, isFinal?: boolean }) => void} [options.onResult] 增量
 * @returns {Promise<{ send: (chunk: Uint8Array|ArrayBuffer|Blob) => Promise<void>, end: () => Promise<{ text: string }>, close: () => void }>} 会话
 */
export async function openSpeechRecognitionSession({
	language,
	hotwords,
	onResult,
} = {}) {
	const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_BASE}/speechRecognition/session`
	const ws = new WebSocket(wsUrl)
	ws.binaryType = 'arraybuffer'

	/** @type {(value: any) => void} */
	let resolveFinal
	/** @type {(reason?: any) => void} */
	let rejectFinal
	const finalPromise = new Promise((resolve, reject) => {
		resolveFinal = resolve
		rejectFinal = reject
	})

	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', () => reject(new Error('SpeechRecognition websocket failed')), { once: true })
	})

	ws.addEventListener('message', event => {
		try {
			const msg = JSON.parse(String(event.data))
			if (msg.type === 'partial') onResult?.({ text: msg.text, isFinal: msg.isFinal })
			else if (msg.type === 'final') {
				onResult?.({ text: msg.text, isFinal: true })
				resolveFinal({ text: msg.text, language: msg.language })
			}
			else if (msg.type === 'error') rejectFinal(new Error(msg.message || 'SpeechRecognition error'))
		}
		catch (error) {
			rejectFinal(error)
		}
	})

	ws.send(JSON.stringify({ type: 'start', language, hotwords }))

	return {
		/**
		 * @param {Uint8Array|ArrayBuffer|Blob} chunk 音频帧
		 * @returns {Promise<void>}
		 */
		send: async (chunk) => {
			if (ws.readyState !== WebSocket.OPEN) throw new Error('SpeechRecognition session closed')
			let bytes
			if (chunk instanceof Blob) bytes = new Uint8Array(await chunk.arrayBuffer())
			else if (chunk instanceof ArrayBuffer) bytes = new Uint8Array(chunk)
			else bytes = chunk
			ws.send(bytes)
		},
		/**
		 * @returns {Promise<{ text: string, language?: string }>} 最终结果
		 */
		end: async () => {
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end' }))
			return finalPromise
		},
		/**
		 * @returns {void}
		 */
		close: () => {
			try { ws.close() } catch { /* ignore */ }
		},
	}
}

/**
 * 将识别文本追加到输入框（保留已有内容）。
 * @param {HTMLTextAreaElement|HTMLInputElement|null} input 输入框
 * @param {string} text 识别文本
 * @returns {void}
 */
export function appendRecognizedText(input, text) {
	if (!(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)) return
	const next = String(text || '').trim()
	if (!next) return
	const cur = input.value
	input.value = cur ? `${cur}${/\s$/.test(cur) ? '' : ' '}${next}` : next
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
