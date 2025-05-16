/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t */

function getSinglePartPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}

/**
 *
 * @param {chatReplyRequest_t} args
 * @param {number} detail_level
 * @returns
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

	while (detail_level--) {
		if (world) result.world_prompt = await world.interfaces.chat.GetPrompt(args, result, detail_level)
		if (user) result.user_prompt = await user.interfaces.chat.GetPrompt(args, result, detail_level)
		if (char) result.char_prompt = await char.interfaces.chat.GetPrompt(args, result, detail_level)
		for (const other_char of Object.keys(other_chars))
			result.other_chars_prompt[other_char] = await other_chars[other_char].interfaces.chat?.GetPromptForOther?.(args, result, detail_level)
		for (const plugin of Object.keys(plugins)) {
			const prompt = await plugins[plugin].interfaces.chat?.GetPrompt?.(args, result, detail_level)
			if (prompt) result.plugin_prompts[plugin] = prompt
		}
	}

	return result
}

export function structPromptToSingleNoChatLog(/** @type {prompt_struct_t} */ prompt) {
	const result = []

	{
		const sorted = prompt.char_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length > 0) {
			result.push('你需要扮演的角色设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = prompt.user_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length > 0) {
			result.push('用户的设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = prompt.world_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		if (sorted.length > 0) {
			result.push('当前环境的设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = Object.values(prompt.other_chars_prompt).map(char => char.text).filter(Boolean).map(
			char => char.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		).flat().filter(Boolean)
		if (sorted.length > 0) {
			result.push('其他角色的设定如下：')
			result.push(...sorted)
		}
	}

	{
		const sorted = Object.values(prompt.plugin_prompts).map(plugin => plugin?.text).filter(Boolean).map(
			plugin => plugin.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
		).flat().filter(Boolean)
		if (sorted.length > 0) {
			result.push('你可以使用以下插件，方法如下：')
			result.push(...sorted)
		}
	}

	return result.join('\n')
}

/**
 * @param {prompt_struct_t} prompt
 * @return {chatLogEntry_t[]}
 */
export function margeStructPromptChatLog(/** @type {prompt_struct_t} */ prompt) {
	const result = [
		...prompt.chat_log,
		...prompt.user_prompt?.additional_chat_log || [],
		...prompt.world_prompt?.additional_chat_log || [],
		...Object.values(prompt.other_chars_prompt).map(char => char.additional_chat_log || []).flat(),
		...Object.values(prompt.plugin_prompts).map(plugin => plugin.additional_chat_log || []).flat(),
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

export function structPromptToSingle(/** @type {prompt_struct_t} */ prompt) {
	const result = [structPromptToSingleNoChatLog(prompt)]

	result.push('聊天记录如下：')
	margeStructPromptChatLog(prompt).forEach((chatLogEntry) => {
		result.push(chatLogEntry.name + ': ' + chatLogEntry.content)
	})

	return result.join('\n')
}
