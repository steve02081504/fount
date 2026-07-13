import {
	findTriggerChatLogEntry,
	hydrateBridgeNativeContext,
	resolveBridgePlatformIds,
} from '../../shells/chat/src/chat/lib/codeBridgeContext.mjs'
import { getDiscordClientForChar } from '../../shells/discordbot/src/default_interface/main.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

const SETUP_PROMPT = `\
Discord API 插件已启用，但当前角色未接入 Discord Bot。
引导用户：在 Discord Developer Portal 创建 Bot 并开启 Message Content / Members / Presence Intent，\
于 [Discord bot 管理](https://steve02081504.github.io/fount/protocol?url=fount://page/parts/shells:discordbot/) 填入 Token 与 OwnerUserName，邀请进服务器后重启。
`

/**
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
 * @returns {Promise<string | undefined>} 无 Bot 时返回接入引导，否则返回 API 说明
 */
async function discordCodePrompt(args) {
	const client = getDiscordClientForChar(args.username, args.char_id)
	if (!client) return SETUP_PROMPT

	const groupId = args.extension?.groupId
	const channelId = args.extension?.channelId
	const inBridge = groupId && channelId && args.username
		&& await resolveBridgePlatformIds(args.username, groupId, channelId).then(ids => ids?.platform === 'discord')

	const lines = [
		'JS 沙箱变量 `discord`：',
		'- `discord.client` — discord.js Client',
	]
	if (inBridge)
		lines.push('- `discord.guild` / `discord.channel` / `discord.message` — 当前 Discord 桥接上下文')
	else
		lines.push('- 当前不在 Discord 桥接群，`guild`/`channel`/`message` 不可用')
	lines.push('示例：`await discord.channel?.send(\'hello\')`')
	return lines.join('\n')
}

/**
 * Discord API 插件：经 `discord` 命名空间操控 Bot。
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
			GetJSCodePrompt: discordCodePrompt,
			/**
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args 聊天回复请求
			 * @returns {Promise<Record<string, unknown>>} 含 `discord` 命名空间对象
			 */
			GetJSCodeContext: async (args) => {
				const client = getDiscordClientForChar(args.username, args.char_id)
				if (!client) return {}

				/** @type {Record<string, unknown>} */
				const discord = { client }
				const groupId = args.extension?.groupId
				const channelId = args.extension?.channelId
				if (groupId && channelId && args.username) {
					const triggerEntry = findTriggerChatLogEntry(args.chat_log)
					const native = await hydrateBridgeNativeContext(args.username, groupId, channelId, triggerEntry)
					if (native?.platform === 'discord') {
						if (native.message) discord.message = native.message
						if (native.channel) discord.channel = native.channel
						if (native.guild) discord.guild = native.guild
					}
				}
				return { discord }
			},
		},
	},
}
