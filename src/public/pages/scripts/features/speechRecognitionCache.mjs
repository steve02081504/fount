/**
 * 本地语音识别转写缓存（按附件键）。
 */
const STORE_KEY = 'fount.speechRecognitionTranscriptCache.v1'

/**
 * @returns {Record<string, string>} 缓存表
 */
function readStore() {
	try {
		return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}
	}
	catch {
		return {}
	}
}

/**
 * @param {Record<string, string>} store 缓存
 * @returns {void}
 */
function writeStore(store) {
	localStorage.setItem(STORE_KEY, JSON.stringify(store))
}

/**
 * @param {string} key 缓存键
 * @returns {string | null} 文本
 */
export function getCachedSpeechRecognitionTranscript(key) {
	if (!key) return null
	const text = readStore()[key]
	return text == null ? null : String(text)
}

/**
 * @param {string} key 缓存键
 * @param {string} text 文本
 * @returns {void}
 */
export function setCachedSpeechRecognitionTranscript(key, text) {
	if (!key) return
	const store = readStore()
	store[key] = String(text || '')
	writeStore(store)
}
