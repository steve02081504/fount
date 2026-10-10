/** Agent Studio 的记录用提示副本；加密位不改变模型实际收到的提示。 */
import { estimateTokenCount } from '../../../serviceGenerators/AI/proxy/src/identityTokenizer.mjs'

/**
 * 用等量估算 token 的 meow 文章遮盖整段文本。原文只用来确定大小和标点种子。
 * @param {string} content 原文。
 * @returns {string} 替换文本；相同输入稳定，以保留跨轮缓存前缀。
 */
export function meowPrompt(content) {
	const text = String(content ?? '')
	const size = estimateTokenCount(text) * 4
	if (!size) return ''
	let seed = 2166136261
	for (const char of text) seed = Math.imul(seed ^ char.codePointAt(0), 16777619) >>> 0
	const chunks = []
	let length = 0
	let words = 0
	while (length + 6 <= size) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
		words++
		const end = words >= 7 + seed % 9
		const chunk = end ? `meow${'.!?'[seed % 3]}${seed % 4 === 0 ? '\n' : ' '}` : `meow${seed % 5 === 0 ? ',' : ''} `
		chunks.push(chunk)
		length += chunk.length
		if (end) words = 0
	}
	const remaining = size - length
	// ASCII 4 字符约一个 token；补齐尾句使替换前后的估算值一致。
	chunks.push(remaining >= 4 ? `meow${'.'.repeat(remaining - 4)}` : '.'.repeat(remaining))
	return chunks.join('')
}

/**
 * 遮盖一个 part 的整段提示或单个 text / additional_chat_log 片段。
 * @param {object} part 单部分提示。
 * @returns {object} 记录用副本。
 */
function redactPart(part) {
	if (!part) return part
	/**
	 * 遮盖完整的文本片段。
	 * @param {object} entry 原始片段。
	 * @returns {object} 记录片段。
	 */
	const redact = entry => {
		if (!part.encrypted && !entry.encrypted) return entry
		return {
			...entry,
			content: meowPrompt(entry.content),
			...entry.description !== undefined ? { description: meowPrompt(entry.description) } : {},
			// 整段加密的附加消息不能通过附件预览泄露正文。
			...entry.files ? { files: [] } : {},
		}
	}
	return {
		...part,
		...part.text ? { text: part.text.map(redact) } : {},
		...part.additional_chat_log ? { additional_chat_log: part.additional_chat_log.map(entry => {
			// 与未遮盖消息一样，把稳定身份留在源条目上，后续轮次复用。
			entry.id ??= crypto.randomUUID()
			return redact(entry)
		}) } : {},
	}
}

/**
 * 在系统提示投影和 BuildPrompt 之前遮盖加密位，避免原文进入任何记录出口。
 * @param {object} prompt 实际模型提示。
 * @returns {object} Agent Studio 专用副本。
 */
export function redactPromptStruct(prompt) {
	const out = { ...prompt }
	for (const key of ['char_prompt', 'user_prompt', 'world_prompt']) out[key] = redactPart(prompt[key])
	for (const key of ['other_chars_prompts', 'other_personas_prompts', 'plugin_prompts'])
		out[key] = Object.fromEntries(Object.entries(prompt[key] ?? {}).map(([name, part]) => [name, redactPart(part)]))
	return out
}
