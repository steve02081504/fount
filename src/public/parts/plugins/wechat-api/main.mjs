import { getWechatRuntimeForChar } from '../../shells/wechatbot/src/default_interface/main.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * WeChat API 插件。
 * 只要角色接入了微信 iLink Bot 且 Bot 正在运行，无论当前在哪个平台聊天，都能通过 JS 调用 wechat_api。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t}
 */
export default {
	info,
	/**
	 * 加载插件
	 */
	Load: async () => { },
	/**
	 * 卸载插件
	 */
	Unload: async () => { },
	interfaces: {
		code_execution: {
			/**
			 * 获取 JS 代码提示
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<string | undefined>} 注入给代码执行的说明字符串；无微信 Bot 时返回引导文案。
			 */
			GetJSCodePrompt: async (args) => {
				const wechat_api = getWechatRuntimeForChar(args.username, args.char_id)
				if (!wechat_api) return `\
WeChat API 插件已启用，但你尚未启动绑定到该角色的微信 Bot，无法使用 wechat_api。
如需接入，请引导用户按以下步骤操作：
在 [微信 bot 管理](https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:wechatbot/) 配置 iLink Token 并启动 Bot（Bot 绑定的 char 须与当前角色一致）。
`
				const inWx = Boolean(args.extension?.wechat_message)
				return `\
你可以在 JS 代码中使用以下变量访问微信 Bot：
- wechat_api：门面对象，含 \`ownerWeChatId\`、\`sendText(text)\`、\`sendFiles(files)\`、\`getChatLogs()\`
${inWx ? '- wechat_message：本轮触发回复的入站微信消息对象\n' : ''}
常用示例：
- 发文本：\`await wechat_api.sendText('你好')\`
- 发文件：\`await wechat_api.sendFiles([{ name: 'a.png', buffer, mime_type: 'image/png' }])\`（\`files\` 为 \`{ name, buffer, mime_type }\` 数组）
- 读缓冲历史：\`const logs = wechat_api.getChatLogs()\` — 返回 \`{name: string, role: 'user' | 'char', content: string, time_stamp: number, files: { name: string, mime_type: string, buffer: global.Buffer<ArrayBufferLike> }[]}[]\`。
`
			},
			/**
			 * 获取 JS 代码上下文
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<Record<string, any>>} 含 wechat_api；若本轮来自微信则另含 wechat_message。
			 */
			GetJSCodeContext: async (args) => {
				const runtimeWechatApi = getWechatRuntimeForChar(args.username, args.char_id)
				if (!runtimeWechatApi) return {}
				const wechat_api = {
					ownerWeChatId: runtimeWechatApi.ownerWeChatId,
					/**
					 * 读取 Bot 内存中的微信聊天缓冲。
					 * @returns {import('../../shells/chat/decl/chatLog.ts').chatLogEntry_t[]} 日志条目数组的深拷贝。
					 */
					getChatLogs: () => runtimeWechatApi.getChatLogs(),
					/**
					 * 发送文本到微信。
					 * @param {string | { text: string, toUserId?: string, contextToken?: string }} text 字符串或完整载荷对象。
					 * @returns {Promise<void>}
					 */
					sendText: async text => await runtimeWechatApi.sendText(text),
					/**
					 * 发送文件到微信。
					 * @param {any[] | { files: any[], toUserId?: string, contextToken?: string }} files 文件列表或完整载荷对象。
					 * @returns {Promise<void>}
					 */
					sendFiles: async files => await runtimeWechatApi.sendFiles(files),
				}
				const wechat_message = args.extension?.wechat_message
				if (wechat_message)
					return { wechat_api, wechat_message }
				return { wechat_api }
			},
		},
	},
}
