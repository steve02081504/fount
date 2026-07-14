import { console } from '../../../../../scripts/i18n/bare.mjs'
import { channelMessageAgentText } from '../../chat/public/shared/channelContent.mjs'
import { dispatchBridgeBotStarted, postBridgeGroupEvent } from '../../chat/src/chat/bridge/groupEvents.mjs'
import { claimOperatorBridgeIdentity } from '../../chat/src/chat/bridge/identity.mjs'
import { postBridgeEdit } from '../../chat/src/chat/bridge/ingress.mjs'
import {
	bridgeIngestDto,
	messageLineToReplyEntry,
	tryFewTimes,
} from '../../chat/src/chat/bridge/interfaceKit.mjs'
import { registerBridgeOps } from '../../chat/src/chat/bridge/ops.mjs'
import { registerBridgeOutbound, unregisterBridgeOutbound } from '../../chat/src/chat/bridge/outbound.mjs'
import { lookupBridgePlatformChannel } from '../../chat/src/chat/bridge/registry.mjs'
import {
	aiMarkdownToTelegramHtml,
	buildTelegramTextAndEntities,
	extractStickerIdsFromMarkdown,
	restoreFountMentionsInText,
	splitTelegramReply,
	telegramMediaGroupToBridgeDto,
	telegramMessageToBridgeDto,
} from '../format.mjs'

/**
 * @typedef {import('npm:telegraf').Telegraf} TelegrafInstance
 * @typedef {import('npm:telegraf').Context} TelegrafContext
 * @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t
 */

/** @type {Record<string, Record<string, TelegrafInstance>>} */
const charBotRegistry = {}

/**
 * @param {string} username replica
 * @param {string} charname 角色名
 * @returns {TelegrafInstance | undefined} 已连接的 Telegraf，未接入时为 undefined
 */
export function getTelegramBotForChar(username, charname) {
	return charBotRegistry[username]?.[charname]
}

/**
 * @param {number | string} chatId chat id
 * @param {number | undefined} threadId thread id
 * @returns {string} 逻辑频道键
 */
function constructLogicalChannelId(chatId, threadId) {
	if (threadId == null) return String(chatId)
	return `${chatId}_${threadId}`
}

/**
 * @param {CharAPI_t} charAPI 角色 API
 * @param {string} ownerUsername replica
 * @param {string} botCharname 角色名
 * @returns {Promise<object>} Telegram 壳层接口对象（BotSetup、GetBotConfigTemplate）
 */
export async function createSimpleTelegramInterface(charAPI, ownerUsername, botCharname) {
	/**
	 * @returns {{ OwnerUserID: string, MediaGroupFlushMs: number }} 默认 bot 配置模板
	 */
	function GetSimpleBotConfigTemplate() {
		return { OwnerUserID: 'YOUR_TELEGRAM_USER_ID', MediaGroupFlushMs: 550 }
	}

	/**
	 * @param {TelegrafInstance} bot Telegraf
	 * @param {{ OwnerUserID: string, MediaGroupFlushMs?: number }} interfaceConfig 配置
	 * @param {string} botname bot 实例名
	 */
	async function SimpleTelegramBotSetup(bot, interfaceConfig, botname) {
		const botInfo = bot.botInfo || await tryFewTimes(() => bot.telegram.getMe())
		const DefaultParseModeOptions = { parse_mode: 'HTML' }
		const stickerMap = charAPI.interfaces.telegram?.stickers || {}
		/** @type {Set<string>} */
		const outboundRegistered = new Set()

		registerBridgeOps(ownerUsername, 'telegram', botname, {
			/**
			 * @param {{ platformChatId: string | number, platformThreadId?: string | number }} params 平台会话
			 */
			sendTyping: async ({ platformChatId, platformThreadId }) => {
				await bot.telegram.sendChatAction(platformChatId, 'typing', {
					...platformThreadId ? { message_thread_id: Number(platformThreadId) } : {},
				})
			},
			/**
			 * @param {{ platformChatId: string | number, platformUserId: string | number }} params 平台会话与用户
			 */
			kickMember: async ({ platformChatId, platformUserId }) => {
				await bot.telegram.banChatMember(platformChatId, Number(platformUserId))
			},
			/**
			 * @param {{ platformChatId: string | number, platformUserId: string | number }} params 平台会话与用户
			 */
			unbanMember: async ({ platformChatId, platformUserId }) => {
				await bot.telegram.unbanChatMember(platformChatId, Number(platformUserId))
			},
			/**
			 * @param {{ platformChatId: string | number }} params 平台会话
			 * @returns {Promise<string>} 邀请链接
			 */
			createInvite: async ({ platformChatId }) =>
				bot.telegram.exportChatInviteLink(platformChatId),
			/**
			 * @param {{ platformChatId: string | number }} params 平台会话
			 */
			leaveChat: async ({ platformChatId }) => {
				await bot.telegram.leaveChat(platformChatId)
			},
			/**
			 * @param {{ platformUserId: string | number }} params 平台用户
			 * @returns {{ platformChatId: number }} 私聊 chat id
			 */
			openDm: async ({ platformUserId }) => ({ platformChatId: Number(platformUserId) }),
			/**
			 * 水合 Telegram chat 与消息 id（code_execution 消费）。
			 * @param {{ platformChatId: string | number, platformMessageId?: string | number, platformThreadId?: string | number }} params 平台定位
			 * @returns {Promise<{ chat: object, chatId: string | number, threadId?: string | number, messageId?: string | number }>} 原生定位
			 */
			getNativeContext: async ({ platformChatId, platformMessageId, platformThreadId }) => ({
				chat: await bot.telegram.getChat(platformChatId),
				chatId: platformChatId,
				threadId: platformThreadId,
				messageId: platformMessageId,
			}),
			/** @returns {Promise<void>} 停止本 bot 实例 */
			stopSelf: async () => {
				const { stopBot } = await import('../bot.mjs')
				await stopBot(ownerUsername, botname)
			},
			/**
			 * @param {{ platformChatId: string | number }} params 平台会话
			 * @returns {Promise<Array<{ platformUserId: string | number, displayName: string }>>} 管理员列表
			 */
			listMembers: async ({ platformChatId }) => {
				const admins = await bot.telegram.getChatAdministrators(platformChatId)
				return admins.map(admin => ({
					platformUserId: admin.user.id,
					displayName: admin.user.first_name || admin.user.username || String(admin.user.id),
				}))
			},
		}, {
			charname: botCharname,
			/** @returns {Promise<void>} 清理 outbound 与 char 注册表 */
			teardown: async () => {
				for (const groupId of outboundRegistered)
					unregisterBridgeOutbound(ownerUsername, groupId)
				outboundRegistered.clear()
				delete charBotRegistry[ownerUsername]?.[botCharname]
				if (charBotRegistry[ownerUsername] && !Object.keys(charBotRegistry[ownerUsername]).length)
					delete charBotRegistry[ownerUsername]
			},
		})

		const ownerUserId = interfaceConfig.OwnerUserID
		if (ownerUserId != null && String(ownerUserId).trim()) {
			let ownerDisplayName = ''
			try {
				const chat = await bot.telegram.getChat(ownerUserId)
				ownerDisplayName = chat.first_name || chat.username || ''
			}
			catch { /* displayName 可选 */ }
			await claimOperatorBridgeIdentity(ownerUsername, 'telegram', ownerUserId, ownerDisplayName)
		}

		/**
		 * @param {string} groupId 群 ID
		 * @param {{ platformChatId: string }} bridge 桥接设置
		 */
		async function ensureOutboundHandler(groupId, bridge) {
			if (outboundRegistered.has(groupId)) return
			registerBridgeOutbound(ownerUsername, groupId, async ({ channelId, messageLine }) => {
				const platformChannel = lookupBridgePlatformChannel(ownerUsername, groupId, channelId)
				const platformChatId = platformChannel?.platformChatId ?? bridge.platformChatId
				const threadKey = platformChannel?.platformThreadId
				const rawText = channelMessageAgentText(messageLine.content) || ''
				const plainText = await restoreFountMentionsInText(ownerUsername, rawText)
				const replyEntry = messageLineToReplyEntry(messageLine, botCharname)
				const { cleanMarkdown, stickerIds } = extractStickerIdsFromMarkdown(plainText)

				/**
				 * @param {{ text?: string, stickerIds?: string[] }} payload 出站载荷
				 * @returns {Promise<{ platformMessageId?: number }>} 首条平台消息 id
				 */
				const sendPayload = async payload => {
					let firstId = null
					if (payload.text?.trim()) {
						const { text, entities } = await buildTelegramTextAndEntities(ownerUsername, payload.text)
						for (const part of splitTelegramReply(aiMarkdownToTelegramHtml(text))) {
							const sent = await tryFewTimes(() => bot.telegram.sendMessage(platformChatId, part, {
								...DefaultParseModeOptions,
								...threadKey ? { message_thread_id: Number(threadKey) } : {},
								...entities.length ? { entities } : {},
							}))
							if (!firstId) firstId = sent.message_id
						}
					}
					for (const stickerId of payload.stickerIds || []) {
						const sent = await tryFewTimes(() => bot.telegram.sendSticker(platformChatId, stickerId, {
							...threadKey ? { message_thread_id: Number(threadKey) } : {},
						}))
						if (!firstId) firstId = sent.message_id
					}
					return { platformMessageId: firstId ?? undefined }
				}

				if (await charAPI.interfaces.telegram?.FormatOutboundReply?.(replyEntry, {
					platform: 'telegram',
					send: sendPayload,
					chatId: platformChatId,
					threadId: threadKey,
				})) return {}

				const fileStickerIds = []
				for (const file of messageLine.files || []) {
					const name = String(file.name || '')
					const base = name.replace(/\.avif$/i, '')
					const mapping = stickerMap[name] || stickerMap[`${base}.avif`] || stickerMap[base]
					if (mapping?.fileId) fileStickerIds.push(mapping.fileId)
				}
				return sendPayload({ text: cleanMarkdown, stickerIds: [...stickerIds, ...fileStickerIds] })
			})
			outboundRegistered.add(groupId)
		}

		/** @type {Map<string, { messages: object[], context: TelegrafContext, timer: ReturnType<typeof setTimeout> | null }>} */
		const telegramMediaGroupBuffers = new Map()

		/**
		 * @param {{ messages: object[], context: TelegrafContext, timer: ReturnType<typeof setTimeout> | null }} state 缓冲
		 * @param {string} bufferKey 键
		 */
		function scheduleMediaGroupFlush(state, bufferKey) {
			if (state.timer) clearTimeout(state.timer)
			state.timer = setTimeout(() => {
				state.timer = null
				flushTelegramMediaGroup(bufferKey)
			}, interfaceConfig.MediaGroupFlushMs ?? 550)
		}

		/**
		 * @param {string} bufferKey 键
		 */
		async function flushTelegramMediaGroup(bufferKey) {
			const state = telegramMediaGroupBuffers.get(bufferKey)
			if (!state) return
			const batch = [...state.messages]
			state.messages.length = 0
			try {
				const dto = await telegramMediaGroupToBridgeDto(state.context, batch, ownerUsername)
				if (dto) await ingestDto(dto)
				if (state.messages.length) scheduleMediaGroupFlush(state, bufferKey)
				else telegramMediaGroupBuffers.delete(bufferKey)
			}
			catch (error) {
				console.error('[TelegramBridge] flushTelegramMediaGroup failed:', error)
				state.messages = [...batch, ...state.messages]
				scheduleMediaGroupFlush(state, bufferKey)
			}
		}

		/**
		 * @param {object} dto 桥接 DTO
		 */
		async function ingestDto(dto) {
			await bridgeIngestDto(ownerUsername, charAPI, 'telegram', dto, ensureOutboundHandler, botname, botCharname)
		}

		bot.on('edited_message', async context => {
			const editedMessage = context.update?.edited_message
			if (!editedMessage) return
			if (editedMessage.chat.type === 'private' && String(editedMessage.from?.id) !== String(interfaceConfig.OwnerUserID))
				return
			if (editedMessage.from?.is_bot) return

			const dto = await telegramMessageToBridgeDto(context, editedMessage, botInfo, ownerUsername)
			if (!dto) return
			try {
				await charAPI.interfaces.telegram?.TweakInboundDto?.(dto)
				await postBridgeEdit(ownerUsername, dto)
			}
			catch (error) { console.error('[TelegramBridge] postBridgeEdit failed:', error) }
		})

		bot.on('message', async context => {
			const { message } = context
			const logicalChannelId = constructLogicalChannelId(message.chat.id, message.message_thread_id)

			if (message.chat.type === 'private' && String(context.from.id) !== String(interfaceConfig.OwnerUserID))
				return
			if (context.from.is_bot) return

			if (message.media_group_id) {
				const bufferKey = `${botInfo.id}:${logicalChannelId}:${message.media_group_id}`
				let state = telegramMediaGroupBuffers.get(bufferKey)
				if (!state) {
					state = { messages: [], context, timer: null }
					telegramMediaGroupBuffers.set(bufferKey, state)
				}
				state.context = context
				if (!state.messages.some(row => row.message_id === message.message_id))
					state.messages.push(message)
				scheduleMediaGroupFlush(state, bufferKey)
				return
			}

			const dto = await telegramMessageToBridgeDto(context, message, botInfo, ownerUsername)
			if (!dto) return
			try { await ingestDto(dto) }
			catch (error) { console.error('[TelegramBridge] postBridgeMessage failed:', error) }
		})

		bot.catch((err, ctx) => {
			console.error(`[TelegramBridge] Telegraf error for update ${ctx.updateType || 'unknown'}:`, err)
		})

		bot.on('my_chat_member', async context => {
			const update = context.update?.my_chat_member
			if (!update?.chat || update.new_chat_member?.user?.id !== botInfo.id) return
			const status = update.new_chat_member?.status
			if (status !== 'member' && status !== 'administrator') return
			try {
				await postBridgeGroupEvent(ownerUsername, {
					type: 'bot_joined_group',
					platform: 'telegram',
					platformChatId: update.chat.id,
					chatName: update.chat.title || String(update.chat.id),
					botname,
				})
			}
			catch (error) { console.error('[TelegramBridge] postBridgeGroupEvent my_chat_member failed:', error) }
		})

		bot.on('chat_member', async context => {
			const update = context.update?.chat_member
			if (!update?.chat || !update.new_chat_member) return
			const status = update.new_chat_member.status
			if (status !== 'left' && status !== 'kicked') return
			try {
				await postBridgeGroupEvent(ownerUsername, {
					type: 'member_left',
					platform: 'telegram',
					platformChatId: update.chat.id,
					member: {
						platformUserId: update.new_chat_member.user.id,
						displayName: update.new_chat_member.user.first_name || update.new_chat_member.user.username,
					},
					botname,
				})
			}
			catch (error) { console.error('[TelegramBridge] postBridgeGroupEvent chat_member failed:', error) }
		})

		await dispatchBridgeBotStarted(ownerUsername, 'telegram', botname)
	}

	return {
		/**
		 * @param {TelegrafInstance} bot Telegraf
		 * @param {{ OwnerUserID: string, MediaGroupFlushMs?: number }} config 配置
		 * @param {string} botname bot 实例名
		 */
		BotSetup: async (bot, config, botname) => {
			charBotRegistry[ownerUsername] ??= {}
			charBotRegistry[ownerUsername][botCharname] = bot
			await SimpleTelegramBotSetup(bot, config, botname)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
