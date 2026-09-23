/**
 * 角色 API 类型别名。
 * @typedef {import('../../../../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t
 */
/** 分片流式内容（800ms/片，模拟真实 AI 流式节奏，供生成中气泡断言增量文本）。 */
const STREAM_CHUNKS = ['流式第一', '段。', '流式第二', '段。']
/** 长报告：围栏期间须可读，闭合后标题与列表须回到正常 Markdown。 */
const RENDER_CHUNKS = [
	'检查结果：\n\n',
	'```text\n' + ['LONG-LINE-' + 'x'.repeat(320), ...Array.from({ length: 118 }, (_, i) => `line ${i + 2}`)].join('\n') + '\n',
	'```\n\n',
	'## 修复计划\n\n- 第一项\n- 第二项\n\n报告结束。',
]
/** 贴底：远超一屏的快速增量，流式期间消息流须持续跟随到底。 */
const FOLLOW_CHUNKS = Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 段：${'贴底跟随的流式内容。'.repeat(6)}\n\n`)
/** 各触发消息对应的分片与间隔。 */
const CHUNK_PLANS = {
	渲染边界测试: { chunks: RENDER_CHUNKS, interval: 800 },
	贴底测试: { chunks: FOLLOW_CHUNKS, interval: 150 },
}

/**
 * 等待指定毫秒。
 * @param {number} ms - 毫秒。
 * @returns {Promise<void>} 完成。
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * code shell 前端测试用流式角色：模仿真实角色模板的 replyPreviewUpdater 包装，
 * 请求级 AI 源存在时走 StructCall，否则自行分片推送预览。
 * @type {CharAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'streamAgent',
			avatar: '',
			description: 'code shell 前端测试用流式回复角色',
			description_markdown: 'code shell 前端测试用流式回复角色。',
			version: '0.0.0',
			author: 'fount test',
			home_page: '',
			tags: ['test'],
		},
	},
	/**
	 * 初始化函数。
	 * @param {object} stat - 部件状态对象。
	 * @returns {void}
	 */
	Init: stat => { },
	/**
	 * 卸载函数。
	 * @param {string} reason - 卸载原因。
	 * @param {string} from - 来源。
	 * @returns {void}
	 */
	Uninstall: (reason, from) => { },
	/**
	 * 加载函数。
	 * @param {object} stat - 部件状态对象。
	 * @returns {void}
	 */
	Load: stat => { },
	/**
	 * 卸载函数。
	 * @param {string} reason - 卸载原因。
	 * @returns {void}
	 */
	Unload: reason => { },
	interfaces: {
		chat: {
			/**
			 * 获取问候语。
			 * @returns {object} 问候内容。
			 */
			GetGreeting: () => ({ content: '你好，我是 streamAgent。' }),
			/**
			 * 获取群组问候语。
			 * @returns {object} 问候内容。
			 */
			GetGroupGreeting: () => ({ content: '大家好，我是 streamAgent。' }),
			/**
			 * 获取提示词。
			 * @returns {Promise<object>} 提示词结构。
			 */
			GetPrompt: async () => ({ text: [{ content: '流式测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取其他角色看到的设定。
			 * @returns {object} 提示词结构。
			 */
			GetPromptForOther: () => ({ text: [{ content: '流式测试角色。', important: 0 }], additional_chat_log: [], extension: {} }),
			/**
			 * 获取回复：包装 replyPreviewUpdater 后分片推送预览（有请求级 AI 源则委托 StructCall）。
			 * @param {object} args - 聊天回复请求。
			 * @returns {Promise<object>} 回复内容。
			 */
			GetReply: async args => {
				args.generation_options ??= {}
				const oriReplyPreviewUpdater = args.generation_options.replyPreviewUpdater
				/**
				 * 请求级预览更新器入口（分片推送后透传请求级更新器）。
				 * @param {object} reply - 预览回复。
				 * @returns {void}
				 */
				args.generation_options.replyPreviewUpdater = reply => oriReplyPreviewUpdater?.(reply)
				const result = { content: '', logContextBefore: [], logContextAfter: [], files: [], extension: {} }
				if (args.ai_source?.StructCall) {
					args.generation_options.base_result = result
					await args.ai_source.StructCall({ text: [] }, args.generation_options)
					return result
				}
				// 无请求级 AI 源（角色自带）：角色自行分片推送预览
				const { chunks, interval } = CHUNK_PLANS[args.chat_log.at(-1)?.content] || { chunks: STREAM_CHUNKS, interval: 800 }
				for (const chunk of chunks) {
					await delay(interval)
					result.content += chunk
					args.generation_options.replyPreviewUpdater({ ...result })
					if (chunks === RENDER_CHUNKS && chunk === RENDER_CHUNKS[1]) await delay(1600)
				}
				return result
			},
		},
	},
}
