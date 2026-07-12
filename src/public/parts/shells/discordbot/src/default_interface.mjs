import { Events, ChannelType, GatewayIntentBits, Partials } from 'npm:discord.js'

import { console } from '../../../../../scripts/i18n/bare.mjs'

/* eslint-disable jsdoc/require-param-description, jsdoc/require-param-type, jsdoc/require-returns, jsdoc/require-returns-description */

import {
	discordMessageToBridgeDto,
	restoreFountMentionsForDiscord,
	splitDiscordReply,
} from './format.mjs'

/**
 * @typedef {import('npm:discord.js').Client} DiscordClient
 * @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/** @type {Record<string, Record<string, DiscordClient>>} */
const charClientRegistry = {}

/**
 * @param {string} username replica
 * @param {string} charname 角色名
 * @returns {DiscordClient | undefined}
 */
export function getDiscordClientForChar(username, charname) {
	return charClientRegistry[username]?.[charname]
}

/**
 * @param {Function} func 异步函数
 * @param {{ times?: number, WhenFailsWaitFor?: number }} [options] 重试选项
 * @returns {Promise<unknown>}
 */
async function tryFewTimes(func, { times = 3, WhenFailsWaitFor = 2000 } = {}) {
	let lastError
	for (let i = 0; i < times; i++) try {
		return await func()
	}
	catch (error) {
		lastError = error
		if (i < times - 1) await new Promise(resolve => setTimeout(resolve, WhenFailsWaitFor))
	}
	throw lastError
}

/**
 * @param {object} messageLine DAG 消息行
 * @param {string} charname 角色名
 * @returns {object} chatLogEntry 形状
 */
function messageLineToReplyEntry(messageLine, charname) {
	const content = messageLine?.content || {}
	return {
		name: charname,
		role: 'char',
		content: typeof content === 'string' ? content : content.text || '',
		content_for_show: typeof content === 'string' ? content : content.text || '',
		time_stamp: messageLine?.hlc?.wall || Date.now(),
		files: (messageLine?.files || []).map(file => ({
			name: file.name,
			mime_type: file.mime_type,
			buffer: file.buffer,
			description: file.description || '',
		})),
		extension: { dagEventId: messageLine?.eventId },
	}
}

/**
 * @param {CharAPI_t} charAPI 角色 API
 * @param {string} ownerUsername replica
 * @param {string} botCharname 角色名
 * @returns {Promise<object>}
 */
export async function createSimpleDiscordInterface(charAPI, ownerUsername, botCharname) {
	/**
	 *
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerUserName: 'your_discord_username',
		}
	}

	/**
	 * @param {DiscordClient} client Discord 客户端
	 * @param {object} interfaceConfig 配置
	 */
	async function SimpleDiscordBotMain(client, interfaceConfig) {
		const { registerBridgeOps } = await import('../../chat/src/chat/bridge/ops.mjs')
		const { postBridgeDelete, postBridgeEdit, postBridgeMessage } = await import('../../chat/src/chat/bridge/ingress.mjs')
		const { registerBridgeOutbound } = await import('../../chat/src/chat/bridge/outbound.mjs')
		const { listBridgeGroupMappings, lookupBridgePlatformChannel } = await import('../../chat/src/chat/bridge/registry.mjs')
		const { channelMessageAgentText } = await import('../../chat/public/shared/channelContent.mjs')

		/** @type {Set<string>} */
		const outboundRegistered = new Set()

		registerBridgeOps('discord', {
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformThreadId
			 */
			sendTyping: async ({ platformChatId, platformThreadId }) => {
				const channel = platformThreadId
					? await client.channels.fetch(String(platformThreadId))
					: await client.channels.fetch(String(platformChatId))
				if (channel?.isTextBased?.()) await channel.sendTyping()
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformUserId
			 */
			kickMember: async ({ platformChatId, platformUserId }) => {
				const guild = await client.guilds.fetch(String(platformChatId))
				await guild.members.kick(String(platformUserId))
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformUserId
			 */
			unbanMember: async ({ platformChatId, platformUserId }) => {
				const guild = await client.guilds.fetch(String(platformChatId))
				await guild.members.unban(String(platformUserId))
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 */
			createInvite: async ({ platformChatId }) => {
				const guild = await client.guilds.fetch(String(platformChatId))
				const invites = await guild.invites.fetch()
				const first = invites.first()
				if (first?.url) return first.url
				const channel = guild.channels.cache.find(ch => ch.isTextBased?.())
				if (!channel) throw new Error('discord createInvite: no text channel')
				const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 })
				return invite.url
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 */
			leaveChat: async ({ platformChatId }) => {
				const guild = await client.guilds.fetch(String(platformChatId))
				await guild.leave()
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformUserId
			 */
			openDm: async ({ platformUserId }) => {
				const user = await client.users.fetch(String(platformUserId))
				const dm = await user.createDM()
				return { platformChatId: dm.id }
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformMessageId
			 */
			getNativeContext: async ({ platformChatId, platformMessageId }) => {
				const channel = await client.channels.fetch(String(platformChatId))
				const message = platformMessageId
					? await channel.messages.fetch(String(platformMessageId))
					: null
				return { discord_client: client, channel, message, guild: channel?.guild }
			},
		})

		/**
		 * @param {string} groupId 群 ID
		 * @param {object} bridge 桥接设置
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
				 *
				 * @param payload
				 */
				const sendPayload = async payload => {
					const sent = await tryFewTimes(() => channel.send(payload))
					return { platformMessageId: sent.id }
				}

				const handled = await charAPI.interfaces.discord?.FormatOutboundReply?.(replyEntry, {
					platform: 'discord',
					send: sendPayload,
					chatId: platformChatId,
					threadId: platformThreadId,
				})
				if (handled) return {}

				let firstMessageId = null
				const textChunks = splitDiscordReply(plainText)
				const fileChunks = []
				const MAX_FILES = 10
				for (let i = 0; i < files.length; i += MAX_FILES)
					fileChunks.push(files.slice(i, i + MAX_FILES))

				if (!textChunks.length && !fileChunks.length) return {}

				for (let i = 0; i < textChunks.length; i++) {
					const isLastText = i === textChunks.length - 1
					const payload = { content: textChunks[i] }
					if (isLastText && fileChunks.length) payload.files = fileChunks.shift()
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

		for (const { groupId } of listBridgeGroupMappings(ownerUsername))
			outboundRegistered.add(groupId)

		/**
		 * @param {object} dto DTO
		 */
		async function ingestDto(dto) {
			await charAPI.interfaces.discord?.TweakInboundDto?.(dto)
			await postBridgeMessage(ownerUsername, dto)
			const { ensureBridgeGroup } = await import('../../chat/src/chat/bridge/registry.mjs')
			const { getState } = await import('../../chat/src/chat/dag/materialize.mjs')
			const { groupId } = await ensureBridgeGroup(ownerUsername, {
				platform: dto.platform,
				platformChatId: dto.platformChatId,
				chatKind: dto.chatKind,
				name: dto.chatName,
			})
			const { state } = await getState(ownerUsername, groupId)
			if (state.groupSettings?.bridge)
				await ensureOutboundHandler(groupId, state.groupSettings.bridge)
		}

		/**
		 * @param {import('npm:discord.js').Message} message Discord 消息
		 * @returns {boolean}
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
			try {
				await ingestDto(dto)
			}
			catch (error) {
				console.error('[DiscordBridge] postBridgeMessage failed:', error)
			}
		})

		client.on(Events.MessageUpdate, async (_oldMessage, newMessage) => {
			if (!shouldAcceptMessage(newMessage)) return
			const dto = await discordMessageToBridgeDto(newMessage, client, ownerUsername)
			if (!dto) return
			try {
				await charAPI.interfaces.discord?.TweakInboundDto?.(dto)
				await postBridgeEdit(ownerUsername, dto)
			}
			catch (error) {
				console.error('[DiscordBridge] postBridgeEdit failed:', error)
			}
		})

		client.on(Events.MessageDelete, async message => {
			if (!message.channelId || !message.id) return
			const isDm = message.channel?.type === ChannelType.DM
			const platformChatId = isDm
				? message.channelId
				: message.guildId || message.channelId
			try {
				await postBridgeDelete(ownerUsername, {
					platform: 'discord',
					platformChatId,
					platformThreadId: isDm ? undefined : message.channelId,
					platformMessageId: message.id,
				})
			}
			catch (error) {
				console.error('[DiscordBridge] postBridgeDelete failed:', error)
			}
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
		 *
		 * @param client
		 * @param config
		 */
		OnceClientReady: async (client, config) => {
			charClientRegistry[ownerUsername] ??= {}
			charClientRegistry[ownerUsername][botCharname] = client
			await SimpleDiscordBotMain(client, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
