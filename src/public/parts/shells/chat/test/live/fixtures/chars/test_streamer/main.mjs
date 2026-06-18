/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

const defaultConfig = {
	initialDelay: 0,
	charDelay: 0,
	testText: 'mock stream reply from test_streamer',
}

const config = { ...defaultConfig }

/**
 * 角色 API 导出类型。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: '测试流输出器',
			avatar: '',
			description: '用于测试流式输出的角色，不需要AI源。',
			description_markdown: '# 测试流输出器\n\nCI fixture：无 AI 源、可流式预览。',
			version: '1.0.0',
			author: 'steve02081504',
			tags: ['测试', '工具', '流式输出'],
		},
		'en-US': {
			name: 'Test Streamer',
			avatar: '🧪',
			description: 'A character for testing streaming output, no AI source required.',
			description_markdown: '# Test Streamer\n\nCI fixture: no AI source, streaming preview.',
			version: '1.0.0',
			author: 'steve02081504',
			tags: ['Testing', 'Tool', 'Streaming'],
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
			/**
			 * @returns {object} 当前流式输出配置
			 */
			GetData: () => ({
				initialDelay: config.initialDelay,
				charDelay: config.charDelay,
				testText: config.testText,
			}),
			/**
			 * @param {object} data 配置字段
			 * @returns {Promise<void>} 更新内存配置
			 */
			SetData: async data => {
				if (data.initialDelay !== undefined)
					config.initialDelay = Math.max(0, parseInt(data.initialDelay) || defaultConfig.initialDelay)
				if (data.charDelay !== undefined)
					config.charDelay = Math.max(0, parseInt(data.charDelay) || defaultConfig.charDelay)
				if (data.testText !== undefined)
					config.testText = data.testText || defaultConfig.testText
			},
		},
		chat: {
			/**
			 * @param {object} arg 含 locales
			 * @param {number} index 问候语索引
			 * @returns {object|undefined} 问候语条目
			 */
			GetGreeting: (arg, index) => {
				const locale = arg.locales[0].split('-')[0]
				if (locale === 'zh')
					return [{ content: '你好！我是测试流输出器。' }][index]
				return [{ content: 'Hello! I am the Test Streamer.' }][index]
			},
			/**
			 * @param {object} arg 含 locales
			 * @param {number} index 问候语索引
			 * @returns {object|undefined} 群问候语条目
			 */
			GetGroupGreeting: (arg, index) => {
				const locale = arg.locales[0].split('-')[0]
				if (locale === 'zh')
					return [{ content: '大家好！我是测试流输出器。' }][index]
				return [{ content: 'Hello everyone! I am the Test Streamer.' }][index]
			},
			/**
			 * @returns {Promise<object>} 角色提示词结构
			 */
			GetPrompt: async () => ({
				text: [{ content: '你是一个测试流输出器。', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
			/**
			 * @returns {object} 其他角色可见的设定
			 */
			GetPromptForOther: () => ({
				text: [{ content: '一个用于测试流式输出的角色。', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
			/**
			 * @param {object} args 聊天回复请求
			 * @returns {Promise<object>} 流式模拟后的回复
			 */
			GetReply: async args => {
				/** @type {import('../../../../../decl/chatLog.ts').chatReply_t} */
				const result = {
					content: '',
					logContextBefore: [],
					logContextAfter: [],
					files: [],
					extension: {},
				}

				const replyPreviewUpdater = args.generation_options?.replyPreviewUpdater
				const text = config.testText
				const delay = config.charDelay
				const initialDelay = config.initialDelay
				const signal = args.generation_options?.signal

				if (initialDelay > 0) {
					await new Promise(resolve => setTimeout(resolve, initialDelay))
					if (signal?.aborted) return result
				}

				for (let i = 0; i < text.length; i++) {
					if (signal?.aborted) break
					result.content += text[i]
					replyPreviewUpdater?.({ ...result })
					if (delay > 0 && i < text.length - 1)
						await new Promise(resolve => setTimeout(resolve, delay))
				}

				return result
			},
		},
	},
}
