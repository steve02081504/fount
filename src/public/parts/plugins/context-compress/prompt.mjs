/**
 * 【文件】prompt.mjs — context-compress 插件的 GetPrompt
 * 【职责】注入 `<compress-context/>` 工具说明，并在可知时附带当前上下文占用（估算 tokens / context_size）与接近阈值的建议。
 * 【原理】GetPrompt 阶段尚无 prompt_struct，故以 `args.chat_log` 拼接文本，并用 AI 源 tokenizer（缺失时权威估算）计数；
 *   占用率仅作提示，不强制压缩——是否压缩由角色手动输出的标签触发。提示词固定中文（提示词不做多语言化）。
 * 【数据结构】返回 single_part_prompt_t：{ text: [{ content, description, important }], additional_chat_log: [], extension: {} }。
 * 【关联】summarize.mjs（countTokens / 阈值语义）、state.mjs（阈值）。
 */
/**
 * @typedef {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} chatReplyRequest_t
 * @typedef {import('../../../../decl/prompt_struct.ts').single_part_prompt_t} single_part_prompt_t
 * @typedef {import('../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */

import { countTokens } from '../../shells/chat/src/chat/session/summarize.mjs'

import { getThreshold } from './state.mjs'

/**
 * context-compress 插件的 GetPrompt：注入压缩工具说明与（可知时）当前上下文占用。
 * @param {chatReplyRequest_t} args 当前聊天请求上下文
 * @returns {single_part_prompt_t} 单段 prompt
 */
export function getContextCompressPrompt(args) {
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
		? `\n当前上下文占用约 ${usage} tokens${overThreshold ? '，已接近上限，建议尽快压缩' : ''}。`
		: ''

	return {
		text: [{
			content: `\
你可以主动压缩过长的对话历史，以腾出上下文空间。

**压缩上下文**（无参数，一次生成最多生效一次）：
<compress-context/>

输出该标签后，系统会把你此前的对话历史整理成一份摘要，并在下一轮用摘要替换旧历史；请基于摘要继续对话，不要重复已总结的内容。
仅当历史确实冗长、接近上限时使用。${usageHint}`,
			description: 'context-compress 插件：上下文压缩工具',
			important: 0,
		}],
		additional_chat_log: [],
		extension: {},
	}
}
