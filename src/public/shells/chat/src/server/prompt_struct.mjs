/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */

function getSinglePartPrompt() {
	return {
		text: [],
		extension: {},
	}
}

export function buildPromptStruct(
	{
		/** @type {UserAPI_t} */
		user,
		/** @type {charAPI_t} */
		char,
		/** @type {charAPI_t[]} */
		other_chars,
		/** @type {WorldAPI_t} */
		world,
		plugins,
		chat_log,
	},
	detail_level = 3
) {
	/** @type {prompt_struct_t} */
	let result = {
		char_prompt: getSinglePartPrompt(),
		user_prompt: getSinglePartPrompt(),
		other_chars_prompt: [],
		world_prompt: getSinglePartPrompt(),
		plugin_prompts: plugins.map((plugin) => plugin.GetPrompt()),
		chat_log,
	}

	for (let i = 0; i < detail_level; i++) {
		if (world) result.world_prompt = world.interfacies.chat.GetPrompt(result)
		if (user) result.user_prompt = user.interfacies.chat.GetPrompt(result)
		if (char) result.char_prompt = char.interfacies.chat.GetPrompt(result)
		result.other_chars_prompt = other_chars.map(char => char.interfacies.chat?.GetPromptForOther?.(result)).filter(x => x)
		result.plugin_prompts = plugins.map(plugin => plugin.interfacies.chat.GetPrompt(result))
	}

	return result
}

export function structPromptToSingleNoChatLog(/** @type {prompt_struct_t} */ prompt) {
	let result = ['续写以下聊天记录']

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
		for (const char of prompt.other_chars_prompt) {
			if (char.text.length > 0) {
				char.text.sort((a, b) => a.important - b.important).forEach((text) => {
					result.push(text.content)
				})
			}
		}
	}

	if (prompt.plugin_prompts.length > 0) {
		result.push('你可以使用以下插件，方法如下：')
		for (const plugin of prompt.plugin_prompts) {
			if (plugin.text.length > 0) {
				plugin.text.sort((a, b) => a.important - b.important).forEach((text) => {
					result.push(text.content)
				})
			}
		}
	}

	console.log(result.join('\n'))
	return result.join('\n')
}

export function structPromptToSingle(/** @type {prompt_struct_t} */ prompt) {
	let result = [structPromptToSingleNoChatLog(prompt)]

	result.push('聊天记录如下：')
	if (prompt.chat_log) {
		prompt.chat_log.forEach((chatLogEntry) => {
			result.push(chatLogEntry.charName + ': ' + chatLogEntry.content)
		})
	}
}
