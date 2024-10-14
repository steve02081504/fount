/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */

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
	const { char, user, world, other_chars, plugins, chat_log, UserCharname, Charname } = args
	/** @type {prompt_struct_t} */
	let result = {
		UserCharname,
		Charname,
		char_prompt: getSinglePartPrompt(),
		user_prompt: getSinglePartPrompt(),
		other_chars_prompt: [],
		world_prompt: getSinglePartPrompt(),
		plugin_prompts: plugins.map((plugin) => plugin.GetPrompt()),
		chat_log,
	}

	while (detail_level--) {
		if (world) result.world_prompt = await world.interfacies.chat.GetPrompt(args, result, detail_level)
		if (user) result.user_prompt = await user.interfacies.chat.GetPrompt(args, result, detail_level)
		if (char) result.char_prompt = await char.interfacies.chat.GetPrompt(args, result, detail_level)
		result.other_chars_prompt = (await Promise.all(other_chars.map(char => char.interfacies.chat?.GetPromptForOther?.(args, result, detail_level)))).filter(x => x)
		result.plugin_prompts = await Promise.all(plugins.map(plugin => plugin.interfacies.chat.GetPrompt(args, result, detail_level)))
	}

	return result
}

export function structPromptToSingleNoChatLog(/** @type {prompt_struct_t} */ prompt) {
	let result = []

	if (prompt.char_prompt.text.length > 0) {
		result.push('你需要扮演的角色设定如下：')
		prompt.char_prompt.text.sort((a, b) => a.important - b.important).forEach((text) => {
			result.push(text.content)
		})
	}

	if (prompt.user_prompt.text.length > 0) {
		result.push('用户的设定如下：')
		prompt.user_prompt.text.sort((a, b) => a.important - b.important).forEach((text) => {
			result.push(text.content)
		})
	}

	if (prompt.world_prompt.text.length > 0) {
		result.push('当前环境的设定如下：')
		prompt.world_prompt.text.sort((a, b) => a.important - b.important).forEach((text) => {
			result.push(text.content)
		})
	}

	if (prompt.other_chars_prompt.length > 0) {
		result.push('其他角色的设定如下：')
		for (const char of prompt.other_chars_prompt)
			if (char.text.length > 0)
				char.text.sort((a, b) => a.important - b.important).forEach((text) => {
					result.push(text.content)
				})
	}

	if (prompt.plugin_prompts.length > 0) {
		result.push('你可以使用以下插件，方法如下：')
		for (const plugin of prompt.plugin_prompts)
			if (plugin.text.length > 0)
				plugin.text.sort((a, b) => a.important - b.important).forEach((text) => {
					result.push(text.content)
				})
	}

	return result.join('\n')
}

export function margeStructPromptChatLog(/** @type {prompt_struct_t} */ prompt) {
	return [
		...prompt.chat_log,
		...prompt.user_prompt?.additional_chat_log || [],
		...prompt.world_prompt?.additional_chat_log || [],
		...prompt.other_chars_prompt.map(char => char.additional_chat_log).flat(),
		...Object.values(prompt.plugin_prompts).map(plugin => plugin.additional_chat_log || []).flat(),
		...prompt.char_prompt?.additional_chat_log || [],
	]
}

export function structPromptToSingle(/** @type {prompt_struct_t} */ prompt) {
	let result = [structPromptToSingleNoChatLog(prompt)]

	result.push('聊天记录如下：')
	margeStructPromptChatLog(prompt).forEach((chatLogEntry) => {
		result.push(chatLogEntry.name + ': ' + chatLogEntry.content)
	})

	return result.join('\n')
}
