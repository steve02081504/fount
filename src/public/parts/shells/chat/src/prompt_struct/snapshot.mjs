/**
 * 【文件】snapshot.mjs — 生成请求快照采集
 * 【职责】在每次 `StructCall` 前把 `prompt_struct` 投影为可 JSON 化的「请求快照」，供 Agent Studio 展示每轮真实 prompt。
 * 【原理】`projectPromptStruct` 用 `structPromptToSingleNoChatLog` 得系统提示、`mergeStructPromptChatLog` 得可见聊天记录（含附加日志与摘要边界）。
 *   采集器 `createPromptRequestRecorder()` 持有轮次数组；调用方在每个 AI 源调用前 `record(prompt)`，同一 prompt_struct 的后续就地修改不再影响已存快照。
 * 【关联】prompt_struct/index.mjs、chat triggerReply、plugins/sub-agent、chars 模板。
 */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { mergeStructPromptChatLog, structPromptToSingleNoChatLog } from './index.mjs'

/** 快照记录的单条内容长度上限（0 表示不限；默认不限以保留完整 prompt）。 */
export const PROMPT_SNAPSHOT_MAX_CHARS = 0

/**
 * 把任意值收敛为可 JSON 化的形式：剥离二进制载荷、函数与不可序列化对象。
 * @param {unknown} value 原值
 * @param {number} [depth] 剩余递归深度
 * @returns {unknown} 可序列化副本
 */
export function sanitizeForJson(value, depth = 12) {
	if (value === null || value === undefined) return value
	const type = typeof value
	if (type === 'string' || type === 'number' || type === 'boolean') return value
	if (type === 'bigint') return value.toString()
	if (type === 'function' || type === 'symbol') return undefined
	if (value instanceof Date) return value.toISOString()
	if (value instanceof Uint8Array || value instanceof ArrayBuffer)
		return { $binary: true, byteLength: value.byteLength ?? value.length ?? 0 }
	if (depth <= 0) return '[truncated]'
	if (Array.isArray(value)) return value.map(item => sanitizeForJson(item, depth - 1))
	if (type === 'object') {
		/** @type {Record<string, unknown>} */
		const out = {}
		for (const [key, item] of Object.entries(value)) {
			const sanitized = sanitizeForJson(item, depth - 1)
			if (sanitized !== undefined) out[key] = sanitized
		}
		return out
	}
	return String(value)
}

/**
 * 截断文本（上限为 0 时不截断）。
 * @param {unknown} value 原值
 * @returns {string} 文本
 */
function clampText(value) {
	const text = String(value ?? '')
	if (!PROMPT_SNAPSHOT_MAX_CHARS || text.length <= PROMPT_SNAPSHOT_MAX_CHARS) return text
	return `${text.slice(0, PROMPT_SNAPSHOT_MAX_CHARS)}…（已截断 ${text.length - PROMPT_SNAPSHOT_MAX_CHARS} 字符）`
}

/**
 * 把 prompt_struct 投影为请求快照：系统提示 + 可见聊天记录。
 * @param {prompt_struct_t} prompt 提示结构
 * @returns {{ systemPrompt: string, messages: Array<{ role: string, name: string, uid: string, content: string }> }} 投影
 */
export function projectPromptStruct(prompt) {
	let systemPrompt = ''
	try {
		systemPrompt = structPromptToSingleNoChatLog(prompt) || ''
	}
	catch (error) {
		console.warn('snapshot: 系统提示投影失败', error)
	}
	let entries = []
	try {
		entries = mergeStructPromptChatLog(prompt) || []
	}
	catch (error) {
		console.warn('snapshot: 聊天记录投影失败', error)
	}
	const messages = entries.map(entry => ({
		role: entry.role ?? 'system',
		name: entry.name ?? '',
		uid: entry.uid ?? '',
		content: clampText(entry.content),
	}))
	return { systemPrompt: clampText(systemPrompt), messages }
}

/**
 * 创建一次生成的请求采集器；每次 AI 源调用前调用 `record`。
 * @returns {{ requests: object[], record: (prompt: prompt_struct_t, extra?: object) => object }} 采集器
 */
export function createPromptRequestRecorder() {
	const requests = []
	/**
	 * 记录一轮请求快照。
	 * @param {prompt_struct_t} prompt 提示结构
	 * @param {{ model?: string, startedAt?: number }} [extra] 额外字段
	 * @returns {object} 快照
	 */
	const record = (prompt, extra = {}) => {
		const startedAt = extra.startedAt ?? Date.now()
		/** @type {object} */
		const entry = {
			index: requests.length + 1,
			startedAt,
			finishedAt: null,
			model: extra.model ?? null,
		}
		try {
			const projected = projectPromptStruct(prompt)
			entry.systemPrompt = projected.systemPrompt
			entry.messages = projected.messages
		}
		catch (error) {
			entry.error = { name: error?.name, message: error?.message ?? String(error) }
		}
		requests.push(entry)
		return entry
	}
	return { requests, record }
}

/**
 * 记录一次请求并使用方持有，返回用于标记完成的函数（写入 finishedAt）。
 * @param {ReturnType<typeof createPromptRequestRecorder>} recorder 采集器
 * @param {prompt_struct_t} prompt 提示结构
 * @param {{ model?: string }} [extra] 额外字段
 * @returns {() => void} 完成回调
 */
export function recordPromptRequest(recorder, prompt, extra = {}) {
	if (!recorder) return () => { }
	const entry = recorder.record(prompt, extra)
	return () => { entry.finishedAt = Date.now() }
}
