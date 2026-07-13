import { Events, ChannelType, GatewayIntentBits, Partials } from 'npm:discord.js'

import { console } from '../../../../../scripts/i18n/bare.mjs'
import { channelMessageAgentText } from '../../chat/public/shared/channelContent.mjs'
import { postBridgeDelete, postBridgeEdit } from '../../chat/src/chat/bridge/ingress.mjs'
import {
	bridgeIngestDto,
	messageLineToReplyEntry,
	primeOutboundRegistered,
	tryFewTimes,
} from '../../chat/src/chat/bridge/interfaceKit.mjs'
import { registerBridgeOps } from '../../chat/src/chat/bridge/ops.mjs'
import { registerBridgeOutbound } from '../../chat/src/chat/bridge/outbound.mjs'
import { lookupBridgePlatformChannel } from '../../chat/src/chat/bridge/registry.mjs'
import {
	discordMessageToBridgeDto,
	restoreFountMentionsForDiscord,
	splitDiscordReply,
} from '../format.mjs'

/**
 * @typedef {import('npm:discord.js').Client} DiscordClient
 * @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/** @type {Record<string, Record<string, DiscordClient>>} */
const charClientRegistry = {}

/**
 * @param {string} username replica
 * @param {string} charname 角色名
 * @returns {DiscordClient | undefined} 已连接的 Client，未接入时为 undefined
 */
export function getDiscordClientForChar(username, charname) {
	return charClientRegistry[username]?.[charname]
}

/**
 * @param {CharAPI_t} charAPI 角色 API
 * @param {string} ownerUsername replica
 * @param {string} botCharname 角色名
 * @returns {Promise<object>} Discord 壳层接口对象（Intents、OnceClientReady 等）
 */
export async function createSimpleDiscordInterface(charAPI, ownerUsername, botCharname) {
	/**
	 * @returns {{ OwnerUserName: string }} 默认 bot 配置模板
	 */
	function GetSimpleBotConfigTemplate() {
		return { OwnerUserName: 'your_discord_username' }
	}

	/**
	 * @param {DiscordClient} client Discord 客户端
	 * @param {{ OwnerUserName: string }} interfaceConfig 配置
	 */
	async function SimpleDiscordBotMain(client, interfaceConfig) {
		/** @type {Set<string>} */
		const outboundRegistered = new Set()

		registerBridgeOps('discord', {
			/**
			 * @param {{ platformChatId: string | number, platformThreadId?: string | number }} params 平台会话
			 */
			sendTyping: async ({ platformChatId, platformThreadId }) => {
				const channel = await client.channels.fetch(String(platformThreadId || platformChatId))
				if (channel?.isTextBased?.()) await channel.sendTyping()
			},
			/**
			 * @param {{ platformChatId: string | number, platformUserId: string | number }} params 平台会话与用户
			 */
			kickMember: async ({ platformChatId, platformUserId }) => {
				const guild = await client.guilds.fetch(String(platformChatId))
				await guild.members.kick(String(platformUserId))
			},
			/**
			 * @param {{ platformChatId: string | number, platformUserId: string | number }} params 平台会话与用户
			 */
			unbanMember: async ({ platformChatId, platformUserId }) => {
				const guild = await client.guilds.fetch(String(platformChatId))
				await guild.members.unban(String(platformUserId))
			},
			/**
			 * @param {{ platformChatId: string | number }} params 平台会话
			 * @returns {Promise<string>} 邀请链接
			 */
			createInvite: async ({ platformChatId }) => {
				const guild = await client.guilds.fetch(String(platformChatId))
				const first = (await guild.invites.fetch()).first()
				if (first?.url) return first.url
				const channel = guild.channels.cache.find(ch => ch.isTextBased?.())
				if (!channel) throw new Error('discord createInvite: no text channel')
				return (await channel.createInvite({ maxAge: 0, maxUses: 0 })).url
			},
			/**
			 * @param {{ platformChatId: string | number }} params 平台会话
			 */
			leaveChat: async ({ platformChatId }) => {
				await (await client.guilds.fetch(String(platformChatId))).leave()
			},
			/**
			 * @param {{ platformUserId: string | number }} params 平台用户
			 * @returns {Promise<{ platformChatId: string }>} DM 频道 id
			 */
			openDm: async ({ platformUserId }) => {
				const dm = await (await client.users.fetch(String(platformUserId))).createDM()
				return { platformChatId: dm.id }
			},
			/**
			 * 水合 discord.js 原生 channel / message / guild（code_execution 消费）。
			 * @param {{ platformChatId: string | number, platformMessageId?: string | number, platformThreadId?: string | number }} params 平台定位
			 * @returns {Promise<{ channel: object, message: object | null, guild: object | null }>} 原生对象
			 */
			getNativeContext: async ({ platformChatId, platformMessageId, platformThreadId }) => {
				const channel = await client.channels.fetch(String(platformThreadId || platformChatId))
				const message = platformMessageId
					? await channel.messages?.fetch?.(String(platformMessageId))
					: null
				return { channel, message, guild: channel?.guild ?? null }
			},
		})

		/**
		 * @param {string} groupId 群 ID
		 * @param {{ platformChatId: string }} bridge 桥接设置
		 */
		async function ensureOutboundHandler(groupId, bridge) {
			if (outboundRegistered.has(groupId)) return
			registerBridgeOutbound(ownerUsername, groupId, async ({ channelId, messageLine }) => {
				const platformChannel = lookupBridgePlatformChannel(ownerUsername, groupId, channelId)
				const platformChatId = platformChannel?.platformChatId ?? bridge.platformChatId
				const platformThreadId = platformChannel?.platformThreadId
				const targetChannelId = platformThreadId || platformChatId
				const channel = await client.channels.fetch(String(targetChannelId))
				if (!channel?.isTextBased?.()) return {}

				const rawText = channelMessageAgentText(messageLine.content) || ''
				const plainText = await restoreFountMentionsForDiscord(ownerUsername, rawText)
				const replyEntry = messageLineToReplyEntry(messageLine, botCharname)
				const files = (messageLine.files || []).map(file => ({
					attachment: file.buffer,
					name: file.name,
					description: file.description,
				}))

				/**
				 * @param {object} payload Discord send 载荷
				 * @returns {Promise<{ platformMessageId: string }>} 首条平台消息 id
				 */
				const sendPayload = async payload => ({
					platformMessageId: (await tryFewTimes(() => channel.send(payload))).id,
				})

				if (await charAPI.interfaces.discord?.FormatOutboundReply?.(replyEntry, {
					platform: 'discord',
					send: sendPayload,
					chatId: platformChatId,
					threadId: platformThreadId,
				})) return {}

				let firstMessageId = null
				const textChunks = splitDiscordReply(plainText)
				const fileChunks = []
				for (let i = 0; i < files.length; i += 10)
					fileChunks.push(files.slice(i, i + 10))

				if (!textChunks.length && !fileChunks.length) return {}

				for (let i = 0; i < textChunks.length; i++) {
					const payload = { content: textChunks[i] }
					if (i === textChunks.length - 1 && fileChunks.length) payload.files = fileChunks.shift()
					const sent = await tryFewTimes(() => channel.send(payload))
					if (!firstMessageId) firstMessageId = sent.id
				}
				for (const chunk of fileChunks) {
					const sent = await tryFewTimes(() => channel.send({ files: chunk }))
					if (!firstMessageId) firstMessageId = sent.id
				}
				return firstMessageId != null ? { platformMessageId: firstMessageId } : {}
			})
			outboundRegistered.add(groupId)
		}

		primeOutboundRegistered(outboundRegistered, ownerUsername)

		/**
		 * @param {object} dto 桥接 DTO
		 */
		async function ingestDto(dto) {
			await bridgeIngestDto(ownerUsername, charAPI, 'discord', dto, ensureOutboundHandler)
		}

		/**
		 * @param {import('npm:discord.js').Message} message Discord 消息
		 * @returns {boolean} 是否应写入 bridge
		 */
		function shouldAcceptMessage(message) {
			if (message.author?.bot) return false
			if (message.channel.type === ChannelType.DM)
				return message.author.username === interfaceConfig.OwnerUserName
			return true
		}

		client.on(Events.MessageCreate, async message => {
			if (!shouldAcceptMessage(message)) return
			const dto = await discordMessageToBridgeDto(message, client, ownerUsername)
			if (!dto) return
			try { await ingestDto(dto) }
			catch (error) { console.error('[DiscordBridge] postBridgeMessage failed:', error) }
		})

		client.on(Events.MessageUpdate, async (_oldMessage, newMessage) => {
			if (!shouldAcceptMessage(newMessage)) return
			const dto = await discordMessageToBridgeDto(newMessage, client, ownerUsername)
			if (!dto) return
			try {
				await charAPI.interfaces.discord?.TweakInboundDto?.(dto)
				await postBridgeEdit(ownerUsername, dto)
			}
			catch (error) { console.error('[DiscordBridge] postBridgeEdit failed:', error) }
		})

		client.on(Events.MessageDelete, async message => {
			if (!message.channelId || !message.id) return
			const isDm = message.channel?.type === ChannelType.DM
			try {
				await postBridgeDelete(ownerUsername, {
					platform: 'discord',
					platformChatId: isDm ? message.channelId : message.guildId || message.channelId,
					platformThreadId: isDm ? undefined : message.channelId,
					platformMessageId: message.id,
				})
			}
			catch (error) { console.error('[DiscordBridge] postBridgeDelete failed:', error) }
		})
	}

	return {
		Intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.GuildPresences,
			GatewayIntentBits.GuildMessageReactions,
			GatewayIntentBits.GuildMessageTyping,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.DirectMessageReactions,
			GatewayIntentBits.DirectMessageTyping,
		],
		Partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction],
		/**
		 * @param {DiscordClient} client Discord 客户端
		 * @param {{ OwnerUserName: string }} config 配置
		 */
		OnceClientReady: async (client, config) => {
			charClientRegistry[ownerUsername] ??= {}
			charClientRegistry[ownerUsername][botCharname] = client
			await SimpleDiscordBotMain(client, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
