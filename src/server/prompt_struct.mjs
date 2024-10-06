/** @typedef {import('../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */
/** @typedef {import('../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */

function getSinglePartPrompt() {
	return {
		text: [],
		extension: {},
	}
}

function buildPromptStruct(
	/** @type {UserAPI_t} */
	user,
	/** @type {charAPI_t} */
	char,
	/** @type {charAPI_t[]} */
	other_chars,
	/** @type {WorldAPI_t} */
	world,
	plugins,
	chatLogs,
	detail_level
) {
	/** @type {prompt_struct_t} */
	let result = {
		char_prompt: getSinglePartPrompt(),
		user_prompt: getSinglePartPrompt(),
		other_chars_prompt: [],
		world_prompt: getSinglePartPrompt(),
		plugin_prompts: plugins.map((plugin) => plugin.GetPrompt()),
		chat_log: chatLogs,
	}

	for (let i = 0; i < detail_level; i++) {
		result.world_prompt = world.interfacies.chat.GetPrompt(result)
		result.user_prompt = user.interfacies.chat.GetPrompt(result)
		result.char_prompt = char.interfacies.chat.GetPrompt(result)
		result.other_chars_prompt = other_chars.map((char) => char.interfacies.chat.GetPromptForOther(result))
		result.plugin_prompts = plugins.map((plugin) => plugin.interfacies.chat.GetPrompt(result))
	}

	return result
}
