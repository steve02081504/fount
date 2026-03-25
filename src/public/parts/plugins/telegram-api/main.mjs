import { getTelegramBotForChar } from '../../shells/telegrambot/src/default_interface/main.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Telegram API 插件。
 * 只要角色接入了 Telegram Bot，无论当前在哪个平台聊天，都能通过 JS 代码操控 Bot。
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
			 * @returns {Promise<string | undefined>} 返回 JS 代码提示或 undefined
			 */
			GetJSCodePrompt: async (args) => {
				const bot = getTelegramBotForChar(args.username, args.char_id)
				if (!bot) return `\
Telegram API 插件已启用，但你尚未被接入任何 Telegram Bot，无法使用 Telegram 相关变量。
如需接入，请引导用户按以下步骤操作：
1. 前往 Telegram 私聊 @BotFather，发送 /newbot，按提示创建 Bot 并获取 Token。
2. 在 [Telegram bot 管理](https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:telegrambot/) 中新建 Bot，填入 Token 和用户自己的 User ID（可通过 @userinfobot 获取）。
3. 将当前角色绑定到该 Bot 即可。
`
				const message = args.extension?.telegram_trigger_message_obj
				if (message)
					return `\
你可以在 JS 代码中使用以下变量访问 Telegram API：
- telegram_client：你的 Telegraf Bot 实例
- message：触发本次回复的 Telegram 消息对象
- chat：消息所在的 Telegram 聊天对象（群组/私聊）
可以用来发消息、禁言/踢人、管理群组等高级操作。
`
				return `\
你可以在 JS 代码中使用以下变量访问 Telegram API：
- telegram_client：你的 Telegraf Bot 实例
不在 Telegram 聊天上下文中，message 和 chat 不可用。
`
			},
			/**
			 * 获取 JS 代码上下文
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<Record<string, any>>} 返回 JS 代码上下文对象
			 */
			GetJSCodeContext: async (args) => {
				const bot = getTelegramBotForChar(args.username, args.char_id)
				if (!bot) return {}
				const message = args.extension?.telegram_trigger_message_obj
				if (message)
					return { telegram_client: bot, message, chat: message.chat }
				return { telegram_client: bot }
			},
		},
	},
}
