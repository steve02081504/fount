/**
 * Local AI 来源生成器的配置模板。
 * @type {object}
 */
export const configTemplate = {
	name: 'local',
	model_path: '',
	llama_options: {},
	load_model_options: {},
	context_options: {},
	session_options: {
		chatWrapper: 'auto',
		systemPrompt: '',
		forceAddSystemPrompt: false,
	},
	prompt_options: {
		temperature: 0.8,
		topK: 40,
		topP: 0.9,
		maxTokens: 2048,
		logprobs: false,
		top_logprobs: 5,
	},
	system_prompt_at_depth: 10,
	convert_config: {
		roleReminding: true
	},
	use_stream: true,
}
