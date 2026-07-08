/**
 * 【文件】src/prompt_struct/index.mjs
 * 【职责】为角色/世界/插件私聊与群聊生成统一 prompt_struct：聚合各 Part 的 GetPrompt、过滤可见消息、构建 timelines。
 * 【原理】buildPromptStruct 并行 await 各 interfaces.chat.GetPrompt；世界可附加 GetGroupPrompt.public；
 *   chat_log 经 canViewMessage 过滤；detail_level 控制附加字段深度。与 decl/prompt_struct.ts 类型对齐供 LLM 调用链使用。
 * 【数据结构】prompt_struct_t：char_prompt、user_prompt、world_prompt、other_chars_prompts、plugin_prompts、chat_log、timelines、locales 等。
 * 【关联】session/generation、triggerReply 调用；依赖 visibility.mjs 与 char/world/user API。
 */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */

import { canViewMessage } from '../chat/lib/visibility.mjs'

/**
 * 获取单部分提示。
 * @returns {{text: Array, additional_chat_log: Array, extension: object}} - 单部分提示对象。
 */
function getSinglePartPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}

/**
 * 构建提示结构。
 * @param {chatReplyRequest_t} args - 参数。
 * @param {number} detail_level - 细节级别。
 * @returns {Promise<prompt_struct_t>} - 提示结构。
 */
export async function buildPromptStruct(
	args,
	detail_level = 3
) {
	const { char_id, char, user, world, other_chars, plugins, chat_log, UserCharname, ReplyToCharname, Charname, timelines, locales } = args
	/** @type {prompt_struct_t} */
	const promptStruct = {
		char_id,
		UserCharname,
		ReplyToCharname,
		Charname,
		char_prompt: getSinglePartPrompt(),
		user_prompt: getSinglePartPrompt(),
		other_chars_prompts: {},
		world_prompt: getSinglePartPrompt(),
		plugin_prompts: {},
		chat_log,
		timelines: timelines || [],
		locales,
	}

	if (world.interfaces.chat.GetPrompt) promptStruct.world_prompt = world.interfaces.chat.GetPrompt(args)
	if (user.interfaces.chat) promptStruct.user_prompt = user.interfaces.chat.GetPrompt(args)
	if (char?.interfaces?.chat) promptStruct.char_prompt = char.interfaces.chat.GetPrompt(args)
	for (const otherCharName of Object.keys(other_chars))
		promptStruct.other_chars_prompts[otherCharName] = other_chars[otherCharName].interfaces.chat?.GetPromptForOther?.(args)
	for (const pluginName of Object.keys(plugins))
		promptStruct.plugin_prompts[pluginName] = plugins[pluginName].interfaces.chat?.GetPrompt?.(args)

	promptStruct.world_prompt = await promptStruct.world_prompt
	if (world.interfaces.chat.GetGroupPrompt) {
		const groupPrompt = await world.interfaces.chat.GetGroupPrompt(args)
		if (groupPrompt?.public)
			promptStruct.world_prompt.text.push({
				content: groupPrompt.public,
				description: 'world group prompt (public)',
				important: 5,
			})
		const memberId = args.extension?.memberId
		if (memberId && groupPrompt?.perMember?.[memberId])
			promptStruct.world_prompt.text.push({
				content: groupPrompt.perMember[memberId],
				description: 'world group prompt (per-member)',
				important: 6,
			})
	}
	promptStruct.user_prompt = await promptStruct.user_prompt
	promptStruct.char_prompt = await promptStruct.char_prompt
	for (const otherCharName of Object.keys(promptStruct.other_chars_prompts))
		promptStruct.other_chars_prompts[otherCharName] = await promptStruct.other_chars_prompts[otherCharName]
	for (const pluginName of Object.keys(promptStruct.plugin_prompts))
		promptStruct.plugin_prompts[pluginName] = await promptStruct.plugin_prompts[pluginName]

	while (detail_level--) await Promise.all([
		world.interfaces.chat.TweakPrompt?.(args, promptStruct, promptStruct.world_prompt, detail_level),
		user.interfaces.chat.TweakPrompt?.(args, promptStruct, promptStruct.user_prompt, detail_level),
		char?.interfaces?.chat?.TweakPrompt?.(args, promptStruct, promptStruct.char_prompt, detail_level),
		...Object.keys(other_chars).map(otherCharName => other_chars[otherCharName].interfaces.chat?.TweakPromptForOther?.(args, promptStruct, promptStruct.other_chars_prompts[otherCharName], detail_level)),
		...Object.keys(plugins).map(pluginName => plugins[pluginName].interfaces.chat?.TweakPrompt?.(args, promptStruct, promptStruct.plugin_prompts[pluginName], detail_level))
	])

	return promptStruct
}

/**
 * 将结构化提示转换为单个无聊天记录的字符串。
 * @param {prompt_struct_t} prompt - 提示结构。
 * @returns {string} - 单个字符串。
 */
export function structPromptToSingleNoChatLog(/** @type {prompt_struct_t} */ prompt) {
	const result = []

	{
		const sorted = prompt.char_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length) {
			result.push('Character settings to role-play:')
			result.push(...sorted)
		}
	}

	{
		const sorted = prompt.user_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length) {
			result.push('User settings:')
			result.push(...sorted)
		}
	}

	{
		const sorted = prompt.world_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length) {
			result.push('World / environment settings:')
			result.push(...sorted)
		}
	}

	{
		const sorted = Object.values(prompt.other_chars_prompts).map(char => char.text).filter(Boolean).map(
			char => char.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		).flat().filter(Boolean)
		if (sorted.length) {
			result.push('Other character settings:')
			result.push(...sorted)
		}
	}

	{
		const sorted = Object.values(prompt.plugin_prompts).map(plugin => plugin?.text).filter(Boolean).map(
			plugin => plugin.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		).flat().filter(Boolean)
		if (sorted.length) {
			result.push('Available plugins and usage:')
			result.push(...sorted)
		}
	}

	return result.join('\n')
}

/**
 * 合并结构化提示聊天记录。
 * @param {prompt_struct_t} prompt - 提示结构。
 * @returns {chatLogEntry_t[]} - 聊天记录条目数组。
 */
export function mergeStructPromptChatLog(/** @type {prompt_struct_t} */ prompt) {
	const result = [
		...prompt.chat_log,
		...prompt.user_prompt?.additional_chat_log || [],
		...prompt.world_prompt?.additional_chat_log || [],
		...Object.values(prompt.other_chars_prompts).map(char => char?.additional_chat_log || []).flat(),
		...Object.values(prompt.plugin_prompts).map(plugin => plugin?.additional_chat_log || []).flat(),
		...prompt.char_prompt?.additional_chat_log || [],
	]
	/** @type {chatLogEntry_t[]} */
	const mergedChatLog = []
	for (const entry of result) {
		if (entry.logContextBefore) mergedChatLog.push(...entry.logContextBefore)
		mergedChatLog.push(entry)
		const feedback = entry.extension?.feedback
		if (feedback) {
			const label = feedback.type === 'up' ? 'upvote' : 'downvote'
			mergedChatLog.push({
				role: 'system',
				name: 'feedback',
				content: `User ${label} this message. Note: ${feedback.content || '(none)'}`,
			})
		}
		if (entry.logContextAfter) mergedChatLog.push(...entry.logContextAfter)
	}
	for (const timelineEntry of prompt.timelines || []) {
		const feedback = timelineEntry.extension?.feedback
		if (!feedback?.content) continue
		const label = feedback.type === 'up' ? 'upvote' : 'downvote'
		mergedChatLog.push({
			role: 'system',
			name: 'feedback',
			content: `User ${label} an alternate-timeline reply. Reason: ${feedback.content}.`,
		})
	}
	return mergedChatLog.filter(entry => entryVisibleForPrompt(entry, prompt))
}

/**
 * 日志条目是否应对当前 prompt 的视角可见。
 * @param {chatLogEntry_t} entry 日志条目
 * @param {chatReplyRequest_t} prompt 当前请求上下文
 * @returns {boolean} 是否纳入 prompt 聊天记录
 */
function entryVisibleForPrompt(entry, prompt) {
	const vis = entry.visibility
	if (!vis) return true
	const viewer = {
		memberId: prompt.extension?.memberId || (prompt.char_id ? `${prompt.username}:${prompt.char_id}` : prompt.username),
		roles: prompt.member_roles || [],
		charId: prompt.char_id,
	}
	if (!vis.roles?.length && !vis.members?.length) return true
	return canViewMessage(vis, viewer)
}

/**
 * 将结构化提示转换为单个字符串。
 * @param {prompt_struct_t} prompt - 提示结构。
 * @returns {string} - 单个字符串。
 */
export function structPromptToSingle(/** @type {prompt_struct_t} */ prompt) {
	const lines = [structPromptToSingleNoChatLog(prompt), 'Chat log:']
	for (const chatLogEntry of mergeStructPromptChatLog(prompt))
		lines.push(`${chatLogEntry.name}: ${chatLogEntry.content}`)
	return lines.join('\n')
}
