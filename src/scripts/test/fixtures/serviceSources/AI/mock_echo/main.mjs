/**
 * 集成测试用 mock AI serviceSource。
 * 回显最后一条用户消息，并报告 PROMPT_MARKER 是否到达 StructCall。
 */

/** 埋入角色描述、供 StructCall 检测的提示标记。 */
export const PROMPT_MARKER = 'FOUNT_PROMPT_MARKER'

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

/**
 * mock 回显 AI 源部件。
 */
export default {
	filename: 'mock_echo',
	type: 'text-chat',
	info: {
		'': {
			name: 'Mock Echo',
			description: 'Deterministic AI source for part create/import tests.',
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
	 * 角色 GetReply 路径使用的结构化调用。
	 * @param {import('fount/decl/prompt_struct.ts').prompt_struct_t} promptStruct prompt
	 * @param {import('fount/decl/AIsource.ts').GenerationOptions} [options] generation options
	 * @returns {Promise<{content: string, files: unknown[]}>} mock reply
	 */
	async StructCall(promptStruct, options = {}) {
		const { base_result = {}, replyPreviewUpdater } = options
		const content = `MOCK_OK|desc=${(promptStruct?.char_prompt?.text || []).some(row => String(row.content || '').includes(PROMPT_MARKER)) ? 1 : 0}|user=${[...promptStruct?.chat_log || []].reverse().find(entry => entry.role === 'user')?.content ?? ''}`
		const result = {
			content,
			files: [...base_result?.files || []],
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
