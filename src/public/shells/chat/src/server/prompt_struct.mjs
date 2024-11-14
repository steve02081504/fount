/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */

function getSinglePartPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}

export async function buildPromptStruct(
	args,
	detail_level = 3
) {
	const { char, user, world, other_chars, plugins, chat_log, UserCharname, ReplyToCharname, Charname } = args
	/** @type {prompt_struct_t} */
	let result = {
		UserCharname,
		ReplyToCharname,
		Charname,
		char_prompt: getSinglePartPrompt(),
		user_prompt: getSinglePartPrompt(),
		other_chars_prompt: [],
		world_prompt: getSinglePartPrompt(),
		plugin_prompts: {},
		chat_log,
	}

	while (detail_level--) {
		if (world) result.world_prompt = await world.interfacies.chat.GetPrompt(args, result, detail_level)
		if (user) result.user_prompt = await user.interfacies.chat.GetPrompt(args, result, detail_level)
		if (char) result.char_prompt = await char.interfacies.chat.GetPrompt(args, result, detail_level)
		result.other_chars_prompt = (await Promise.all(other_chars.map(char => char.interfacies.chat?.GetPromptForOther?.(args, result, detail_level)))).filter(x => x)
		for (let plugin of Object.keys(plugins))
			result.plugin_prompts[plugin] = await plugins[plugin].interfacies.chat?.GetPrompt?.(args, result, detail_level)
	}

	return result
}

export function structPromptToSingleNoChatLog(/** @type {prompt_struct_t} */ prompt) {
	let result = []

	{
		let sorted = prompt.char_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(text => text)
		if (sorted.length > 0) {
			result.push('你需要扮演的角色设定如下：')
			result.push(...sorted)
		}
	}

	{
		let sorted = prompt.user_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(text => text)
		if (sorted.length > 0) {
			result.push('用户的设定如下：')
			result.push(...sorted)
		}
	}

	{
		let sorted = prompt.world_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(text => text)
		if (sorted.length > 0) {
			result.push('当前环境的设定如下：')
			result.push(...sorted)
		}
	}

	{
		let sorted = prompt.other_chars_prompt.map(char => char.text).filter(text => text).map(
			char => char.sort((a, b) => a.important - b.important).map(text => text.content).filter(text => text)
		).flat().filter(text => text)
		if (sorted.length > 0) {
			result.push('其他角色的设定如下：')
			result.push(...sorted)
		}
	}

	{
		let sorted = Object.values(prompt.plugin_prompts).map(plugin => plugin.text).filter(text => text).map(
			plugin => plugin.sort((a, b) => a.important - b.important).map(text => text.content).filter(text => text)
		).flat().filter(text => text)
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
	let result = [
		...prompt.chat_log,
		...prompt.user_prompt?.additional_chat_log || [],
		...prompt.world_prompt?.additional_chat_log || [],
		...prompt.other_chars_prompt.map(char => char.additional_chat_log || []).flat(),
		...Object.values(prompt.plugin_prompts).map(plugin => plugin.additional_chat_log || []).flat(),
		...prompt.char_prompt?.additional_chat_log || [],
	]
	let flat_result = []
	for (const entry of result) {
		if (entry.logContextBefore) flat_result.push(...entry.logContextBefore)
		flat_result.push(entry)
		if (entry.logContextAfter) flat_result.push(...entry.logContextAfter)
	}
	return flat_result
}

export function structPromptToSingle(/** @type {prompt_struct_t} */ prompt) {
	let result = [structPromptToSingleNoChatLog(prompt)]

	result.push('聊天记录如下：')
	margeStructPromptChatLog(prompt).forEach((chatLogEntry) => {
		result.push(chatLogEntry.name + ': ' + chatLogEntry.content)
	})

	return result.join('\n')
}
