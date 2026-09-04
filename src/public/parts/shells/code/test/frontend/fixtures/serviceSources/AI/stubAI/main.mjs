/**
 * AI 源类型别名。
 * @typedef {import('../../../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t
 */
/**
 * code shell 前端测试用 AI 源 stub：仅用于验证 AI 源 pill 下拉与选择，不发起真实调用。
 * @type {AIsource_t}
 */
export default {
	filename: 'stubAI',
	type: 'text-chat',
	info: {
		'zh-CN': {
			name: 'stubAI',
			provider: 'fount-test',
			description: 'code shell 前端测试用 AI 源',
			description_markdown: 'code shell 前端测试用 AI 源。',
			version: '0.0.0',
			author: 'fount test',
			tags: ['test'],
		},
	},
	is_paid: false,
	extension: {},
	interfaces: {},
	/**
	 * 调用 AI 源。
	 * @returns {Promise<string>} 回复文本。
	 */
	Call: async () => '测试回复。',
	tokenizer: {
		/**
		 * 释放资源。
		 * @returns {Promise<void>} 完成。
		 */
		free: async () => { },
		/**
		 * 编码。
		 * @returns {number[]} token 序列。
		 */
		encode: () => [],
		/**
		 * 解码。
		 * @returns {string} 原始文本。
		 */
		decode: () => '',
		/**
		 * 解码单个 token。
		 * @returns {string} 原始文本。
		 */
		decode_single: () => '',
		/**
		 * 获取 token 数量。
		 * @returns {number} token 数量。
		 */
		get_token_count: () => 0,
	},
}