/** @typedef {import('../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */

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
	const { char_id, char, user, world, other_chars, plugins, chat_log, UserCharname, ReplyToCharname, Charname } = args
	/** @type {prompt_struct_t} */
	const result = {
		char_id,
		UserCharname,
		ReplyToCharname,
		Charname,
		char_prompt: getSinglePartPrompt(),
		user_prompt: getSinglePartPrompt(),
		other_chars_prompt: {},
		world_prompt: getSinglePartPrompt(),
		plugin_prompts: {},
		chat_log,
	}

	if (world?.interfaces?.chat) result.world_prompt = world.interfaces.chat.GetPrompt(args)
	if (user?.interfaces?.chat) result.user_prompt = user.interfaces.chat.GetPrompt(args)
	if (char?.interfaces?.chat) result.char_prompt = char.interfaces.chat.GetPrompt(args)
	for (const other_char of Object.keys(other_chars))
		result.other_chars_prompt[other_char] = other_chars[other_char].interfaces.chat?.GetPromptForOther?.(args)
	for (const plugin of Object.keys(plugins))
		result.plugin_prompts[plugin] = plugins[plugin].interfaces.chat?.GetPrompt?.(args)

	result.world_prompt = await result.world_prompt
	result.user_prompt = await result.user_prompt
	result.char_prompt = await result.char_prompt
	for (const other_char of Object.keys(result.other_chars_prompt))
		result.other_chars_prompt[other_char] = await result.other_chars_prompt[other_char]
	for (const plugin of Object.keys(result.plugin_prompts))
		result.plugin_prompts[plugin] = await result.plugin_prompts[plugin]

	while (detail_level--) await Promise.all([
		world?.interfaces?.chat?.TweakPrompt?.(args, result, result.world_prompt, detail_level),
		user?.interfaces?.chat?.TweakPrompt?.(args, result, result.user_prompt, detail_level),
		char?.interfaces?.chat?.TweakPrompt?.(args, result, result.char_prompt, detail_level),
		...Object.keys(other_chars).map(other_char => other_chars[other_char].interfaces.chat?.TweakPromptForOther?.(args, result, other_chars_prompt[other_char], detail_level)),
		...Object.keys(plugins).map(plugin => plugins[plugin].interfaces.chat?.TweakPrompt?.(args, result, result.plugin_prompts[plugin], detail_level))
	])

	return result
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
			result.push('你需要扮演的角色设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = prompt.user_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length) {
			result.push('用户的设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = prompt.world_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length) {
			result.push('当前环境的设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = Object.values(prompt.other_chars_prompt).map(char => char.text).filter(Boolean).map(
			char => char.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		).flat().filter(Boolean)
		if (sorted.length) {
			result.push('其他角色的设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = Object.values(prompt.plugin_prompts).map(plugin => plugin?.text).filter(Boolean).map(
			plugin => plugin.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		).flat().filter(Boolean)
		if (sorted.length) {
			result.push('你可以使用以下插件，方法如下：')
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
export function margeStructPromptChatLog(/** @type {prompt_struct_t} */ prompt) {
	const result = [
		...prompt.chat_log,
		...prompt.user_prompt?.additional_chat_log || [],
		...prompt.world_prompt?.additional_chat_log || [],
		...Object.values(prompt.other_chars_prompt).map(char => char?.additional_chat_log || []).flat(),
		...Object.values(prompt.plugin_prompts).map(plugin => plugin?.additional_chat_log || []).flat(),
		...prompt.char_prompt?.additional_chat_log || [],
	]
	/** @type {chatLogEntry_t[]} */
	const flat_result = []
	for (const entry of result) {
		if (entry.logContextBefore) flat_result.push(...entry.logContextBefore)
		flat_result.push(entry)
		if (entry.logContextAfter) flat_result.push(...entry.logContextAfter)
	}
	return flat_result.filter(entry => !entry.charVisibility || entry.charVisibility.includes(prompt.char_id))
}

/**
 * 将结构化提示转换为单个字符串。
 * @param {prompt_struct_t} prompt - 提示结构。
 * @returns {string} - 单个字符串。
 */
export function structPromptToSingle(/** @type {prompt_struct_t} */ prompt) {
	const result = [structPromptToSingleNoChatLog(prompt)]

	result.push('聊天记录如下：')
	margeStructPromptChatLog(prompt).forEach(chatLogEntry => {
		result.push(chatLogEntry.name + ': ' + chatLogEntry.content)
	})

	return result.join('\n')
}
