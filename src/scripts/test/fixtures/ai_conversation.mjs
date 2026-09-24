/**
 * 测试用「同一场对话」prompt_struct 构造器。
 *
 * 每轮由测试向 `chat_log` 追加 user / char 条目（带稳定 id），再取一份新的
 * prompt_struct 交给 AI 源的 `StructCall`。用于验证各 provider 在会话增长时
 * 发送的 prompt 是否保持稳定前缀（纯追加）。
 */

/**
 * 创建一场可增长的对话。
 * @param {object} [options] 选项
 * @param {string} [options.charName] 角色名
 * @param {string} [options.userName] 用户名
 * @param {string} [options.charPrompt] 角色设定
 * @returns {{
 *   chat_log: object[],
 *   makePromptStruct: () => object,
 *   addUser: (content: string, id?: string) => object,
 *   addChar: (content: string, id?: string) => object,
 * }} 对话句柄
 */
export function createPromptStructConversation(options = {}) {
	const charName = options.charName ?? 'Mock-Char'
	const userName = options.userName ?? 'Tester'
	/** @type {object[]} */
	const chat_log = []

	/**
	 * 构造一个 prompt 文本块。
	 * @param {string} content 文本内容
	 * @returns {{ text: Array<{ important: number, content: string }>, additional_chat_log: object[] }} 文本块
	 */
	const block = content => ({
		text: [{ important: 0, content }],
		additional_chat_log: [],
	})

	/**
	 * 生成当前轮次的 prompt_struct（共享同一 chat_log 数组）。
	 * @returns {object} prompt_struct
	 */
	const makePromptStruct = () => ({
		username: userName,
		char_id: charName,
		Charname: charName,
		UserCharname: userName,
		char_prompt: block(options.charPrompt ?? `You are ${charName}, a test character.`),
		user_prompt: block(`The user is ${userName}.`),
		world_prompt: block('A quiet test room.'),
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: {},
		chat_log,
		timelines: [],
		locales: ['zh-CN'],
	})

	return {
		chat_log,
		makePromptStruct,
		/**
		 * 追加一条用户消息。
		 * @param {string} content 消息内容
		 * @param {string} [id] 稳定 id（缺省按序号生成）
		 * @returns {object} 追加的条目
		 */
		addUser(content, id) {
			const entry = { id: id ?? `user-${chat_log.length}`, name: userName, uid: 'user', role: 'user', content }
			chat_log.push(entry)
			return entry
		},
		/**
		 * 追加一条角色回复。
		 * @param {string} content 消息内容
		 * @param {string} [id] 稳定 id（缺省按序号生成）
		 * @returns {object} 追加的条目
		 */
		addChar(content, id) {
			const entry = { id: id ?? `char-${chat_log.length}`, name: charName, uid: 'char', role: 'char', content }
			chat_log.push(entry)
			return entry
		},
	}
}
