/**
 * 【文件】prompt.mjs — context-compress 插件的 GetPrompt
 * 【职责】注入 `<compress-context/>` 工具说明，并在可知时附带当前上下文占用（估算 tokens / context_size）与接近阈值的建议。
 * 【原理】GetPrompt 阶段尚无 prompt_struct，故以 `args.chat_log` 拼接文本，并用 AI 源 tokenizer（缺失时脚本感知估算）计数；
 *   占用率仅作提示，不强制压缩——是否压缩由角色手动输出的标签触发。
 * 【数据结构】返回 single_part_prompt_t：{ text: [{ content, description, important }], additional_chat_log: [], extension: {} }。
 * 【关联】summarize.mjs（needsCompression 的阈值语义）、proxy identityTokenizer（估算）、state.mjs（阈值与 locale）。
 */
/**
 * @typedef {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} chatReplyRequest_t
 * @typedef {import('../../../../decl/prompt_struct.ts').single_part_prompt_t} single_part_prompt_t
 * @typedef {import('../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */

import { estimateTokenCount } from '../../serviceGenerators/AI/proxy/src/identityTokenizer.mjs'

import { getThreshold, prefersChinese } from './state.mjs'

/**
 * 估算 prompt 文本的 token 数：优先 AI 源 tokenizer，缺失或失败时按脚本感知估算。
 * @param {AIsource_t | undefined} aiSource AI 源
 * @param {string} text 待估算文本
 * @returns {number} token 估算数
 */
function countTokens(aiSource, text) {
	try {
		const count = aiSource?.tokenizer?.get_token_count?.(text)
		if (typeof count === 'number' && Number.isFinite(count)) return count
	}
	catch {
		// tokenizer 异常时回退到通用估算
	}
	return estimateTokenCount(text)
}

/**
 * context-compress 插件的 GetPrompt：注入压缩工具说明与（可知时）当前上下文占用。
 * @param {chatReplyRequest_t} args 当前聊天请求上下文
 * @returns {single_part_prompt_t} 单段 prompt
 */
export function getContextCompressPrompt(args) {
	const zh = prefersChinese(args?.locales)
	const aiSource = args?.ai_source
	const chatLog = args?.chat_log ?? []
	const transcript = chatLog
		.map(entry => `${entry.name || entry.role || ''}: ${entry.content || ''}`)
		.join('\n')

	const tokens = countTokens(aiSource, transcript)
	const contextSize = Number(aiSource?.context_size)
	const hasUsage = Number.isFinite(contextSize) && contextSize > 0
	const usage = hasUsage ? `${tokens}/${contextSize}` : null
	const overThreshold = hasUsage && tokens / contextSize >= getThreshold()

	const usageHint = usage
		? zh
			? `\n当前上下文占用约 ${usage} tokens${overThreshold ? '，已接近上限，建议尽快压缩' : ''}。`
			: `\nCurrent context usage is about ${usage} tokens${overThreshold ? ', close to the limit; compress soon' : ''}.`
		: ''

	const content = zh
		? `\
你可以主动压缩过长的对话历史，以腾出上下文空间。

**压缩上下文**（无参数，一次生成最多生效一次）：
<compress-context/>

输出该标签后，系统会把你此前的对话历史整理成一份摘要，并在下一轮用摘要替换旧历史；请基于摘要继续对话，不要重复已总结的内容。
仅当历史确实冗长、接近上限时使用。${usageHint}`
		: `\
You can proactively compress an over-long conversation history to free up context space.

**Compress context** (no parameters, at most once per generation):
<compress-context/>

After you emit this tag the system folds your prior history into a summary and replaces the old history with it in the next round; continue from the summary and do not repeat what it already covers.
Use it only when the history is genuinely long and near the limit.${usageHint}`

	return {
		text: [{
			content,
			description: zh ? 'context-compress 插件：上下文压缩工具' : 'context-compress plugin: context compression tool',
			important: 0,
		}],
		additional_chat_log: [],
		extension: {},
	}
}
