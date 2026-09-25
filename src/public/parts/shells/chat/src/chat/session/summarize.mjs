/**
 * 【文件】summarize.mjs — 上下文压缩（总结）
 * 【职责】判定 prompt 是否接近 AI 源上下文上限（needsCompression）；直连 AI 源生成 `type='summary'` 摘要条目并收敛本轮 prompt（compressContext）。
 * 【原理】使用 ai_source.context_size 与 tokenizer（缺失时按权威估算器估算）计算占用率；摘要条目写入 result.logContextBefore 供侧车跨轮持久化，
 *   同时把 prompt_struct.chat_log 收敛为 [摘要]，后续 regen 经 summaryBoundary 只保留摘要之后的历史。同一 result 只压缩一次。
 * 【关联】decl/chatLog.ts（isSummaryEntry / SUMMARY_ENTRY_TYPE）、prompt_struct/index.mjs、char 模板 regen、plugins/context-compress。
 */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */

import { estimateTokenCount } from '../../../../../serviceGenerators/AI/proxy/src/identityTokenizer.mjs'
import { isSummaryEntry, SUMMARY_ENTRY_TYPE } from '../logEntryTypes.mjs'
import { mergeStructPromptChatLog, structPromptToSingle } from '../../prompt_struct/index.mjs'

/** 已在本轮压缩过的 result（防止同一生成重复压缩）。 @type {WeakSet<object>} */
const compressedResults = new WeakSet()

/**
 * 估算文本 token 数：优先 AI 源 tokenizer，缺失或失败时按权威估算器。
 * @param {AIsource_t} aiSource AI 源
 * @param {string} text 文本
 * @returns {number} token 数估算
 */
export function countTokens(aiSource, text) {
	try {
		const count = aiSource?.tokenizer?.get_token_count?.(text)
		if (typeof count === 'number' && Number.isFinite(count)) return count
	}
	catch { /* 回退通用估算 */ }
	return estimateTokenCount(text)
}

/**
 * 判断当前 prompt 是否达到压缩阈值。
 * @param {chatReplyRequest_t} args 请求上下文（读取 `ai_source`）
 * @param {{ threshold?: number, prompt_struct?: prompt_struct_t }} [options] 选项
 * @returns {boolean} 是否应压缩
 */
export function needsCompression(args, { threshold = 0.729, prompt_struct } = {}) {
	const aiSource = args?.ai_source
	const contextSize = aiSource?.context_size
	if (!contextSize || contextSize <= 0) return false
	const prompt = prompt_struct
		? structPromptToSingle(prompt_struct)
		: (args?.chat_log || []).map(entry => `${entry.name || entry.role || ''}: ${entry.content || ''}`).join('\n')
	return countTokens(aiSource, prompt) / contextSize >= threshold
}

/**
 * 构建摘要指令（提示词固定中文，不做多语言化）。
 * @param {string} transcript 对话记录文本
 * @returns {string} 摘要指令
 */
function buildSummaryPrompt(transcript) {
	const instruction = `\
请把下面的对话历史压缩成一份精炼的摘要，供你此后继续对话时使用。
要求：
- 保留关键事实、人物与关系、已达成的约定、未完成的任务、重要设定与用户偏好；
- 不要编造未出现的信息；
- 不要输出任何工具调用标签或代码块标记；
- 直接输出摘要正文。`
	return `${instruction}\n\n---\n${transcript}\n---`
}

/**
 * 压缩上下文：直连 AI 源生成摘要条目，写入 result.logContextBefore 并收敛 prompt_struct.chat_log。
 * @param {{ args: chatReplyRequest_t, aiSource?: AIsource_t, prompt_struct: prompt_struct_t, result?: object }} params 参数
 * @returns {Promise<chatLogEntry_t | null>} 生成的摘要条目；不满足条件或失败时 null
 */
export async function compressContext({ args, aiSource, prompt_struct, result }) {
	aiSource ??= args?.ai_source
	if (!aiSource?.Call || !prompt_struct) return null
	if (result && compressedResults.has(result)) return null

	const merged = mergeStructPromptChatLog(prompt_struct)
	if (!merged.some(entry => !isSummaryEntry(entry) && entry.content)) return null
	const transcript = merged.filter(entry => entry.content)
		.map(entry => `${entry.name || entry.role || 'unknown'}: ${entry.content}`)
		.join('\n\n')

	let content
	try {
		content = await aiSource.Call(buildSummaryPrompt(transcript))
	}
	catch (error) {
		console.warn('context compression failed:', error)
		return null
	}
	if (typeof content !== 'string' || !content.trim()) return null

	/** @type {chatLogEntry_t} */
	const entry = {
		id: crypto.randomUUID(),
		name: SUMMARY_ENTRY_TYPE,
		uid: 'system',
		role: 'system',
		time_stamp: new Date(),
		content: content.trim(),
		type: SUMMARY_ENTRY_TYPE,
	}
	if (args?.char_id) entry.charVisibility = [args.char_id]
	if (result) {
		result.logContextBefore ??= []
		result.logContextBefore.push(entry)
		compressedResults.add(result)
	}
	prompt_struct.chat_log = [entry]
	return entry
}
