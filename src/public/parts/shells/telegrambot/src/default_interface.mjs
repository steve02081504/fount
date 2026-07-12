import { console } from '../../../../../scripts/i18n/bare.mjs'

/* eslint-disable jsdoc/require-param-description, jsdoc/require-param-type, jsdoc/require-returns, jsdoc/require-returns-description */
import {
	aiMarkdownToTelegramHtml,
	buildTelegramTextAndEntities,
	extractStickerIdsFromMarkdown,
	restoreFountMentionsInText,
	splitTelegramReply,
	telegramMediaGroupToBridgeDto,
	telegramMessageToBridgeDto,
} from './format.mjs'

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
 * @returns {TelegrafInstance | undefined}
 */
export function getTelegramBotForChar(username, charname) {
	return charBotRegistry[username]?.[charname]
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
 * @returns {object}
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
 * @param {number | string} chatId chat id
 * @param {number | undefined} threadId thread id
 * @returns {string}
 */
function constructLogicalChannelId(chatId, threadId) {
	if (Object(threadId) instanceof Number) return `${chatId}_${threadId}`
	return String(chatId)
}

/**
 * @param {CharAPI_t} charAPI 角色 API
 * @param {string} ownerUsername replica
 * @param {string} botCharname 角色名
 * @returns {Promise<object>}
 */
export async function createSimpleTelegramInterface(charAPI, ownerUsername, botCharname) {
	/**
	 * @returns {object}
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerUserID: 'YOUR_TELEGRAM_USER_ID',
			MediaGroupFlushMs: 550,
		}
	}

	/**
	 * @param {TelegrafInstance} bot Telegraf
	 * @param {object} interfaceConfig 配置
	 */
	async function SimpleTelegramBotSetup(bot, interfaceConfig) {
		const { registerBridgeOps } = await import('../../chat/src/chat/bridge/ops.mjs')
		const { postBridgeEdit, postBridgeMessage } = await import('../../chat/src/chat/bridge/ingress.mjs')
		const { registerBridgeOutbound } = await import('../../chat/src/chat/bridge/outbound.mjs')
		const { listBridgeGroupMappings, lookupBridgePlatformChannel } = await import('../../chat/src/chat/bridge/registry.mjs')
		const { channelMessageAgentText } = await import('../../chat/public/shared/channelContent.mjs')

		const botInfo = bot.botInfo || await tryFewTimes(() => bot.telegram.getMe())
		const DefaultParseModeOptions = { parse_mode: 'HTML' }
		/** @type {Set<string>} */
		const outboundRegistered = new Set()

		registerBridgeOps('telegram', {
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformThreadId
			 */
			sendTyping: async ({ platformChatId, platformThreadId }) => {
				await bot.telegram.sendChatAction(platformChatId, 'typing', {
					...platformThreadId ? { message_thread_id: Number(platformThreadId) } : {},
				})
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformUserId
			 */
			kickMember: async ({ platformChatId, platformUserId }) => {
				await bot.telegram.banChatMember(platformChatId, Number(platformUserId))
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformUserId
			 */
			unbanMember: async ({ platformChatId, platformUserId }) => {
				await bot.telegram.unbanChatMember(platformChatId, Number(platformUserId))
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 */
			createInvite: async ({ platformChatId }) =>
				bot.telegram.exportChatInviteLink(platformChatId),
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 */
			leaveChat: async ({ platformChatId }) => {
				await bot.telegram.leaveChat(platformChatId)
			},
			/**
			 *
			 * @param root0
			 * @param root0.platformUserId
			 */
			openDm: async ({ platformUserId }) => ({ platformChatId: Number(platformUserId) }),
			/**
			 *
			 * @param root0
			 * @param root0.platformChatId
			 * @param root0.platformMessageId
			 */
			getNativeContext: async ({ platformChatId, platformMessageId }) => ({
				telegram: bot.telegram,
				platformChatId,
				platformMessageId,
			}),
		})

		/**
		 * @param {string} groupId 群 ID
		 * @param {object} bridge 桥接设置
		 * @returns {Promise<void>}
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
				 *
				 * @param payload
				 */
				const sendPayload = async payload => {
					let firstId = null
					if (payload.text?.trim()) {
						const { text, entities } = await buildTelegramTextAndEntities(ownerUsername, payload.text)
						const html = aiMarkdownToTelegramHtml(text)
						const parts = splitTelegramReply(html)
						for (const part of parts) {
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

				const handled = await charAPI.interfaces.telegram?.FormatOutboundReply?.(replyEntry, {
					platform: 'telegram',
					send: sendPayload,
					chatId: platformChatId,
					threadId: threadKey,
				})
				if (handled) return {}

				let firstMessageId = null
				if (cleanMarkdown.trim()) {
					const { text, entities } = await buildTelegramTextAndEntities(ownerUsername, cleanMarkdown)
					const html = aiMarkdownToTelegramHtml(text)
					const parts = splitTelegramReply(html)
					for (const part of parts) {
						const sent = await tryFewTimes(() => bot.telegram.sendMessage(platformChatId, part, {
							...DefaultParseModeOptions,
							...threadKey ? { message_thread_id: Number(threadKey) } : {},
							...entities.length ? { entities } : {},
						}))
						if (!firstMessageId) firstMessageId = sent.message_id
					}
				}
				for (const stickerId of stickerIds) {
					const sent = await tryFewTimes(() => bot.telegram.sendSticker(platformChatId, stickerId, {
						...threadKey ? { message_thread_id: Number(threadKey) } : {},
					}))
					if (!firstMessageId) firstMessageId = sent.message_id
				}
				return firstMessageId != null ? { platformMessageId: firstMessageId } : {}
			})
			outboundRegistered.add(groupId)
		}

		for (const { groupId } of listBridgeGroupMappings(ownerUsername))
			outboundRegistered.add(groupId)

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
		 * @param {object} dto DTO
		 * @returns {Promise<void>}
		 */
		async function ingestDto(dto) {
			await charAPI.interfaces.telegram?.TweakInboundDto?.(dto)
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
			catch (error) {
				console.error('[TelegramBridge] postBridgeEdit failed:', error)
			}
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
			try {
				await ingestDto(dto)
			}
			catch (error) {
				console.error('[TelegramBridge] postBridgeMessage failed:', error)
			}
		})

		bot.catch((err, ctx) => {
			console.error(`[TelegramBridge] Telegraf error for update ${ctx.updateType || 'unknown'}:`, err)
		})
	}

	return {
		/**
		 *
		 * @param bot
		 * @param config
		 */
		BotSetup: async (bot, config) => {
			charBotRegistry[ownerUsername] ??= {}
			charBotRegistry[ownerUsername][botCharname] = bot
			await SimpleTelegramBotSetup(bot, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
