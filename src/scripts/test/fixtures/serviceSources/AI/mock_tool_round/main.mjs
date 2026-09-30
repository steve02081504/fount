/**
 * 集成测试用 mock AI serviceSource：两阶段工具轮。
 * 首轮返回 ZL-31 的 `<get-tool-info>` 工具调用；一旦本轮已有工具日志（`base_result.logContextBefore` 非空），
 * 次轮返回 `MOCK_ROUND_DONE`，用于验证 chat shell 缺少 `finishRound` 时 regen 循环仍会继续。
 */

/**
 * 文本聊天源使用的恒等 tokenizer。
 */
const tokenizer = {
	/**
	 * @returns {number} always 0
	 */
	free: () => 0,
	/**
	 * @param {string} prompt prompt text
	 * @returns {string} unchanged
	 */
	encode: prompt => prompt,
	/**
	 * @param {string} tokens token blob
	 * @returns {string} unchanged
	 */
	decode: tokens => tokens,
	/**
	 * @param {string} token single token
	 * @returns {string} unchanged
	 */
	decode_single: token => token,
	/**
	 * @param {string} prompt prompt text
	 * @returns {number} length
	 */
	get_token_count: prompt => prompt.length,
}

/** 首轮返回的工具调用原文。 */
const FIRST_ROUND_CONTENT = '<get-tool-info>persona-generator</get-tool-info>'
/** 次轮返回的完成标记。 */
const SECOND_ROUND_CONTENT = 'MOCK_ROUND_DONE|rounds=2'

/**
 * mock 工具轮 AI 源部件。
 */
export default {
	filename: 'mock_tool_round',
	type: 'text-chat',
	info: {
		'': {
			name: 'Mock Tool Round',
			description: 'Deterministic AI source that drives one tool round then finishes.',
			provider: 'fount-test',
		},
	},
	is_paid: false,
	extension: {},
	tokenizer,
	/**
	 * 空操作加载。
	 * @returns {void}
	 */
	Load() { },
	/**
	 * 纯文本调用。
	 * @param {string} prompt prompt
	 * @returns {Promise<{content: string}>} echo
	 */
	async Call(prompt) {
		return { content: String(prompt) }
	},
	/**
	 * 角色 GetReply 路径使用的结构化调用：按本轮是否已有工具日志分两阶段返回。
	 * @param {import('fount/decl/prompt_struct.ts').prompt_struct_t} promptStruct prompt
	 * @param {import('fount/decl/AIsource.ts').GenerationOptions} [options] generation options
	 * @returns {Promise<{content: string, files: unknown[]}>} mock reply
	 */
	async StructCall(promptStruct, options = {}) {
		const { base_result = {}, replyPreviewUpdater } = options
		const priorRound = base_result?.logContextBefore
		const hasPriorRound = Array.isArray(priorRound) && priorRound.length > 0
		const content = hasPriorRound ? SECOND_ROUND_CONTENT : FIRST_ROUND_CONTENT
		const result = {
			content,
			files: [...base_result?.files || []],
			content_for_show: content,
		}
		replyPreviewUpdater?.(result)
		return Object.assign(base_result, result)
	},
	interfaces: {
		config: {
			/**
			 * @returns {object} empty config
			 */
			GetData: () => ({}),
			/**
			 * @returns {Promise<void>}
			 */
			SetData: async () => { },
		},
	},
}
