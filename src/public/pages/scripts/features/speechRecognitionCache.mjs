/**
 * 本地语音识别转写缓存（按附件键）。
 */
const STORE_KEY = 'fount.speechRecognitionTranscriptCache.v1'
const MAX_ENTRIES = 100

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
 * 按插入顺序淘汰超出上限的最旧条目，并落盘（localStorage 配额已满时静默跳过）。
 * @param {Record<string, string>} store 缓存
 * @returns {void}
 */
function writeStore(store) {
	const keys = Object.keys(store)
	for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete store[key]
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(store))
	}
	catch { /* 配额已满等持久化失败不应影响识别流程 */ }
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
	store[key] = text
	writeStore(store)
}
