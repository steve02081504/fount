import {
	findTriggerChatLogEntry,
	hydrateBridgeNativeContext,
	resolveBridgePlatformIds,
} from '../../shells/chat/src/chat/lib/codeBridgeContext.mjs'
import { getTelegramBotForChar } from '../../shells/telegrambot/src/default_interface/main.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

const SETUP_PROMPT = `\
Telegram API 插件已启用，但当前角色未接入 Telegram Bot。
引导用户：向 @BotFather 创建 Bot 获取 Token，于 [Telegram bot 管理](https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:telegrambot/) 填入 Token 与 OwnerUserID，绑定当前角色。
`

/**
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
 * @returns {Promise<string | undefined>} 无 Bot 时返回接入引导，否则返回 API 说明
 */
async function telegramCodePrompt(args) {
	const bot = getTelegramBotForChar(args.username, args.char_id)
	if (!bot) return SETUP_PROMPT

	const groupId = args.extension?.groupId
	const channelId = args.extension?.channelId
	const inBridge = groupId && channelId && args.username
		&& await resolveBridgePlatformIds(args.username, groupId, channelId).then(ids => ids?.platform === 'telegram')

	const lines = [
		'JS 沙箱变量 `telegram`：',
		'- `telegram.client` — Telegraf 实例',
		'- `telegram.api` — Bot API（`bot.telegram`）',
	]
	if (inBridge)
		lines.push('- `telegram.chat` / `telegram.chatId` / `telegram.threadId` / `telegram.messageId` — 当前 Telegram 桥接上下文')
	else
		lines.push('- 当前不在 Telegram 桥接群，chat 相关字段不可用')
	lines.push('示例：`await telegram.api.sendMessage(telegram.chatId, \'hello\')`')
	return lines.join('\n')
}

/**
 * Telegram API 插件：经 `telegram` 命名空间操控 Bot。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t}
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
			GetJSCodePrompt: telegramCodePrompt,
			/**
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<Record<string, unknown>>} 含 `telegram` 命名空间对象
			 */
			GetJSCodeContext: async (args) => {
				const bot = getTelegramBotForChar(args.username, args.char_id)
				if (!bot) return {}

				/** @type {Record<string, unknown>} */
				const telegram = { client: bot, api: bot.telegram }
				const groupId = args.extension?.groupId
				const channelId = args.extension?.channelId
				if (groupId && channelId && args.username) {
					const triggerEntry = findTriggerChatLogEntry(args.chat_log)
					const native = await hydrateBridgeNativeContext(args.username, groupId, channelId, triggerEntry)
					if (native?.platform === 'telegram') {
						if (native.chat) telegram.chat = native.chat
						if (native.chatId != null) telegram.chatId = native.chatId
						if (native.threadId != null) telegram.threadId = native.threadId
						if (native.messageId != null) telegram.messageId = native.messageId
					}
				}
				return { telegram }
			},
		},
	},
}
