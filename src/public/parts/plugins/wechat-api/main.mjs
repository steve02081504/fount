import { getWechatRuntimeForChar } from '../../shells/wechatbot/src/default_interface/main.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

const SETUP_PROMPT = `\
WeChat API 插件已启用，但当前角色未启动微信 Bot。
引导用户：在 [微信 bot 管理](https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:wechatbot/) 配置 iLink Token 并启动（Bot 须绑定当前角色）。
`

/**
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
 * @returns {Promise<string | undefined>} 近期未提及微信时为 undefined；否则返回 API 说明或接入引导
 */
async function wechatCodePrompt(args) {
	if (!args.chat_log?.slice(-4).some(entry => /wechat|微信|weixin/i.test(entry?.content ?? ''))) return

	const runtime = getWechatRuntimeForChar(args.username, args.char_id)
	if (!runtime) return SETUP_PROMPT

	return `\
JS 沙箱变量 \`wechat\`：
- \`wechat.ownerWeChatId\` — 主人微信 ID
- \`wechat.sendText(text)\` / \`wechat.sendFiles(files)\` — 发消息与文件
历史消息请用 \`fount.channel.messages()\`（桥接模式下 chat DAG 即历史）。
`
}

/**
 * WeChat API 插件：经 `wechat` 命名空间操控 iLink Bot。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t} 插件 API
 */
export default {
	info,
	/**
	 *
	 */
	Load: async () => { },
	/**
	 *
	 */
	Unload: async () => { },
	interfaces: {
		code_execution: {
			GetJSCodePrompt: wechatCodePrompt,
			/**
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<Record<string, unknown>>} 含 `wechat` 命名空间对象
			 */
			GetJSCodeContext: async (args) => {
				const runtime = getWechatRuntimeForChar(args.username, args.char_id)
				if (!runtime) return {}

				return {
					wechat: {
						ownerWeChatId: runtime.ownerWeChatId,
						/**
						 * @param {string | { text: string, toUserId?: string, contextToken?: string }} text 文本或载荷
						 * @returns {Promise<void>}
						 */
						sendText: text => runtime.sendText(text),
						/**
						 * @param {any[] | { files: any[], toUserId?: string, contextToken?: string }} files 文件或载荷
						 * @returns {Promise<void>}
						 */
						sendFiles: files => runtime.sendFiles(files),
					},
				}
			},
		},
	},
}
