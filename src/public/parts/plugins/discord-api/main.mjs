import { getDiscordClientForChar } from '../../shells/discordbot/src/default_interface/main.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Discord API 插件。
 * 只要角色接入了 Discord Bot，无论当前在哪个平台聊天，都能通过 JS 代码操控 Bot。
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
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<string | undefined>} 返回 JS 代码提示或 undefined
			 */
			GetJSCodePrompt: async (args) => {
				const client = getDiscordClientForChar(args.username, args.char_id)
				if (!client) return `\
Discord API 插件已启用，但你尚未被接入任何 Discord Bot，无法使用 Discord 相关变量。
如需接入，请引导用户按以下步骤操作：
1. 前往 https://discord.com/developers/applications，点击 New Application 创建应用并在 Bot 页面获取 Token。
2. 在 Bot 页面开启 Presence Intent、Server Members Intent、Message Content Intent 三个开关。
3. 在 [Discord bot 管理](https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:discordbot/) 中新建 Bot，填入 Token，并将配置里的 OwnerUserName 设置为用户自己的 Discord 用户名。
4. 通过 OAuth2 -> URL Generator 生成邀请链接，将 Bot 邀请进目标服务器后重启即可。
`
				const message = args.extension?.discord_trigger_message_obj
				if (message)
					return `\
你可以在 JS 代码中使用以下变量访问 Discord API：
- discord_client：你的 Discord.js Client 实例
- message：触发本次回复的 Discord 消息对象
- channel：消息所在的 Discord 频道对象
${message.guild ? '- guild：消息所在的服务器对象' : '当前为 DM，没有 guild 字段'}
可以用来发消息、设置身份组、踢人/封禁用户、管理服务器等高级操作。
`

				return `\
你可以在 JS 代码中使用以下变量访问 Discord API：
- discord_client：你的 Discord.js Client 实例
不在 Discord 聊天上下文中，message、channel 和 guild 不可用。
`
			},
			/**
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<Record<string, any>>} 返回 JS 代码上下文对象
			 */
			GetJSCodeContext: async (args) => {
				const client = getDiscordClientForChar(args.username, args.char_id)
				if (!client) return {}
				const message = args.extension?.discord_trigger_message_obj
				if (message)
					return { discord_client: client, message, channel: message.channel, guild: message.guild }
				return { discord_client: client }
			},
		},
	},
}
