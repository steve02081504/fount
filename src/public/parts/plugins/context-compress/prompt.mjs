/**
 * 【文件】prompt.mjs — context-compress 插件的 prompt 参与
 * 【职责】GetPrompt 注入 `<compress-context/>` 工具说明（稳定文本）；TweakPrompt 阶段再追加/原地更新「当前上下文占用」条目。
 * 【原理】GetPrompt 阶段拿到的只有 `args`（`prompt_struct` 尚在构建中），无法权威统计占用，故此处只产出不含易变文本的稳定工具说明；
 *   占用统计放在 `TweakPrompt(arg, prompt_struct, my_prompt, detail_level)`——此时 `prompt_struct` 已由 buildPromptStruct 装配完成，
 *   可用 `structPromptToSingle` 统计真实 token 数（含系统提示与历史）。
 *   占用条目使用固定 id 并置于 `my_prompt.additional_chat_log`：同一会话内固定 id 使 Agent Studio 复原对话时按 update 处理而非每轮新增；
 *   条目只随 TweakPrompt 原地更新，不进入 system prompt，因此不破坏按前缀命中的 prompt 缓存。
 *   提示词固定中文（提示词不做多语言化）。
 * 【数据结构】single_part_prompt_t：{ text: [{ content, description, important }], additional_chat_log, extension: {} }。
 * 【关联】summarize.mjs（countTokens / 阈值语义）、state.mjs（阈值）、main.mjs（TweakPrompt 装配）。
 */
/**
 * @typedef {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} chatReplyRequest_t
 * @typedef {import('../../../../decl/prompt_struct.ts').single_part_prompt_t} single_part_prompt_t
 * @typedef {import('../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 * @typedef {import('../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */

import { countTokens } from '../../shells/chat/src/chat/session/summarize.mjs'
import { structPromptToSingle } from '../../shells/chat/src/prompt_struct/index.mjs'

import { getThreshold } from './state.mjs'

/** 占用提示条目的固定 id（同一会话内稳定，使对话复原按 update 归并）。 */
export const USAGE_ENTRY_ID = 'context-compress:usage'

/** 占用提示条目 `name`（人类可读标签）。 */
export const USAGE_ENTRY_NAME = 'context-usage'

/** 占用提示条目的 extension 标记，供 TweakPrompt 原地识别。 */
export const USAGE_EXTENSION = { contextCompress: true }

/**
 * context-compress 插件的 GetPrompt：只注入稳定的压缩工具说明。
 *
 * 不注入「当前上下文占用」——该值每轮变化，进入 system prompt 序列会破坏 prompt 缓存前缀；
 * 且 GetPrompt 阶段尚无权威的 prompt_struct 可用于统计。占用提示由 {@link applyContextUsageHint} 在 TweakPrompt 阶段处理。
 * @param {chatReplyRequest_t} args 当前聊天请求上下文
 * @returns {single_part_prompt_t} 单段 prompt
 */
export function getContextCompressPrompt(args) {
	return {
		text: [{
			content: `\
你可以主动压缩过长的对话历史，以腾出上下文空间。

**压缩上下文**（无参数，一次生成最多生效一次）：
<compress-context/>

输出该标签后，系统会把你此前的对话历史整理成一份摘要，并在下一轮用摘要替换旧历史；请基于摘要继续对话，不要重复已总结的内容。
仅当历史确实冗长、接近上限时使用。`,
			description: 'context-compress 插件：上下文压缩工具',
			important: 0,
		}],
		additional_chat_log: [],
		extension: {},
	}
}

/**
 * 计算当前 prompt 的占用提示文本；无可用 AI 源或上下文上限时返回 null。
 * @param {chatReplyRequest_t} args 请求上下文（读取 `ai_source`）
 * @param {prompt_struct_t} promptStruct 已装配的 prompt 结构
 * @returns {string | null} 占用提示文本
 */
export function buildUsageHint(args, promptStruct) {
	const aiSource = args?.ai_source
	if (!aiSource) return null
	const contextSize = Number(aiSource?.context_size)
	if (!Number.isFinite(contextSize) || contextSize <= 0) return null
	// 以已装配的 prompt_struct 权威统计（含系统提示与历史）；缺失时退回可见 chat_log。
	const transcript = promptStruct
		? structPromptToSingle(promptStruct)
		: (args?.chat_log ?? []).map(entry => `${entry.name || entry.role || ''}: ${entry.content || ''}`).join('\n')
	const tokens = countTokens(aiSource, transcript)
	if (!tokens) return null
	const overThreshold = tokens / contextSize >= getThreshold()
	const percent = (tokens / contextSize * 100).toFixed(1)
	return `当前上下文占用约 ${tokens} tokens（估算，含系统提示与历史），模型上下文上限 ${contextSize} tokens，占用约 ${percent}%${overThreshold ? '，已接近上限，建议尽快压缩' : ''}。`
}

/**
 * 判断条目是否为 context-compress 的占用提示条目。
 * @param {object} entry 日志条目
 * @returns {boolean} 是否为占用提示条目
 */
function isUsageEntry(entry) {
	return entry?.id === USAGE_ENTRY_ID || entry?.extension?.contextCompress === true
}

/**
 * TweakPrompt 阶段写入 / 原地更新「当前上下文占用」条目。
 *
 * 首次在该 part 的 `additional_chat_log` 末尾追加固定 id 的占用条目；后续轮次只更新同一条目的 `content` 与 `time_stamp`，
 * 不新增条目（避免每轮多出一条 system 消息，也避免 Agent Studio 复原对话时错位）。
 * @param {chatReplyRequest_t} args 请求上下文
 * @param {prompt_struct_t} promptStruct 已装配的 prompt 结构
 * @param {single_part_prompt_t} myPrompt 本插件的 prompt 段（占用条目的落点）
 * @returns {void}
 */
export function applyContextUsageHint(args, promptStruct, myPrompt) {
	if (!myPrompt) return
	const hint = buildUsageHint(args, promptStruct)
	if (!hint) return
	myPrompt.additional_chat_log ??= []
	const existing = myPrompt.additional_chat_log.find(isUsageEntry)
	if (existing) {
		existing.content = hint
		existing.time_stamp = new Date().toISOString()
		return
	}
	myPrompt.additional_chat_log.push({
		id: USAGE_ENTRY_ID,
		role: 'system',
		name: USAGE_ENTRY_NAME,
		uid: 'system',
		time_stamp: new Date().toISOString(),
		content: hint,
		files: [],
		extension: { ...USAGE_EXTENSION },
	})
}
