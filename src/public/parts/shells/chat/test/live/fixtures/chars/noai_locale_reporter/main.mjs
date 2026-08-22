/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/**
 * 返回基于首选 locale 的本地化回复标记。
 * @param {string[]} locales 首选 locale 列表
 * @returns {string} 本地化回复文本
 */
function localizedReply(locales) {
	const prefix = String(locales?.[0] || '').split('-')[0]
	if (prefix === 'zh') return '【中文回复】'
	if (prefix === 'en') return '【English reply】'
	return '【Other reply】'
}

/**
 * 角色 API 导出类型。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: '本地化回复器',
			avatar: '🌐',
			description: '用于测试角色回复是否跟随用户消息 locale 的角色。',
			description_markdown: '# 本地化回复器\n\nCI fixture：无 AI 源、回复内容随 locale 变化。',
			version: '1.0.0',
			author: 'steve02081504',
			tags: ['测试', '工具', 'locale'],
		},
		'en-US': {
			name: 'Locale Reporter',
			avatar: '🌐',
			description: 'A character for testing locale-aware replies.',
			description_markdown: '# Locale Reporter\n\nCI fixture: no AI source, reply varies by locale.',
			version: '1.0.0',
			author: 'steve02081504',
			tags: ['Testing', 'Tool', 'locale'],
		},
	},

	/** @returns {void} 无操作 */
	Init: () => { },
	/** @returns {void} 无操作 */
	Uninstall: () => { },
	/** @returns {void} 无操作 */
	Load: () => { },
	/** @returns {void} 无操作 */
	Unload: () => { },

	interfaces: {
		config: {
			/** @returns {object} 空配置 */
			GetData: () => ({}),
			/** @param {object} _data 配置字段 */
			SetData: async _data => { },
		},
		chat: {
			/** @param {object} arg 含 locales */
			/** @returns {object} 问候语 */
			GetGreeting: () => [{ content: '你好！我是本地化回复器。' }][0],
			/** @param {object} arg 含 locales */
			/** @returns {object} 群问候语 */
			GetGroupGreeting: () => [{ content: '大家好！我是本地化回复器。' }][0],
			/** @returns {Promise<object>} 角色提示词结构 */
			GetPrompt: async () => ({
				text: [{ content: '你是一个本地化回复器。', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
			/** @returns {object} 其他角色可见的设定 */
			GetPromptForOther: () => ({
				text: [{ content: '一个用于测试本地化回复的角色。', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
			/**
			 * 生成角色回复。
			 * @param {object} args 聊天回复请求
			 * @returns {Promise<object>} 回复内容
			 */
			GetReply: async args => ({ content: localizedReply(args.locales) }),
		},
	},
}
