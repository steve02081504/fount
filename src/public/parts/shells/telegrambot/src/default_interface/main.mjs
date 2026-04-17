import { localhostLocales, console } from '../../../../../../scripts/i18n.mjs'
import { getPartInfo } from '../../../../../../scripts/locale.mjs'
import { getAnyPreferredDefaultPart, loadPart } from '../../../../../../server/parts_loader.mjs'

import {
	TelegramMessageToFountChatLogEntry,
	telegramMediaGroupMessagesToFountChatLogEntry,
	applyTelegramMessageUpdateToChannelLog,
	resolveTelegramChatLogEntryFilesInPlace,
	splitTelegramReply,
	aiMarkdownToTelegramHtml,
	escapeHTML,
	extractStickerIdsFromMarkdown
} from './tools.mjs'

/** @typedef {import('npm:telegraf').Telegraf} TelegrafInstance */
/** @typedef {import('npm:telegraf').Context} TelegrafContext */
/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */

/**
 * 按用户/角色索引当前正在运行的默认 Telegram Bot 实例。
 * 结构为 registry[username][charname] = TelegrafInstance
 * @type {Record<string, Record<string, TelegrafInstance>>}
 */
const charBotRegistry = {}

/**
 * 获取指定用户下指定角色当前正在运行的默认 Telegram Bot 实例。
 * 供插件或外部代码访问 Telegraf 实例（如主动发消息、管理群组等）。
 * 注意：若同一角色同时绑定了多个 Bot，此处返回最近启动的那个。
 * @param {string} username - 角色所属的 fount 用户名。
 * @param {string} charname - 角色名称（fount charname）。
 * @returns {TelegrafInstance | undefined} Telegraf Instance 实例或 undefined
 */
export function getTelegramBotForChar(username, charname) {
	return charBotRegistry[username]?.[charname]
}
/** @typedef {import('../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/** @typedef {import('./tools.mjs').chatLogEntry_t_simple} chatLogEntry_t_simple */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */

/**
 * 重试函数
 * @param {Function} func - 要执行的异步函数。
 * @param {object} [options] - 重试选项。
 * @param {number} [options.times=3] - 重试次数。
 * @param {number} [options.WhenFailsWaitFor=2000] - 失败时等待时间。
 * @returns {Promise<any>} - 函数执行结果。
 */
async function tryFewTimes(func, { times = 3, WhenFailsWaitFor = 2000 } = {}) {
	let lastError
	for (let i = 0; i < times; i++) try {
		return await func()
	} catch (error) {
		lastError = error
		console.warn(`[TelegramDefaultInterface] tryFewTimes: Attempt ${i + 1} failed. Error: ${error.message?.replace(/([!#()*+.=>[\]_`{|}~-])/g, '\\$1')}`)
		if (i < times - 1) await new Promise(resolve => setTimeout(resolve, WhenFailsWaitFor))
	}

	console.error(`[TelegramDefaultInterface] tryFewTimes: All ${times} attempts failed. Last error:`, lastError)
	throw lastError
}

/**
 * 辅助函数：构造逻辑频道 ID。
 * @param {number | string} chatId - Telegram 的 chat.id。
 * @param {number | undefined} threadId - Telegram 消息的 message_thread_id。
 * @returns {string} 逻辑频道 ID。
 */
function constructLogicalChannelIdForDefault(chatId, threadId) {
	if (Object(threadId) instanceof Number) return `${chatId}_${threadId}`
	return String(chatId)
}

/**
 * 为没有自定义 Telegram 接口的角色创建一个简单的默认 Telegram 接口。
 * @param {CharAPI_t} charAPI - 角色的 API 对象。
 * @param {string} ownerUsername - fount 系统的用户名。
 * @param {string} botCharname - 当前bot绑定的角色名称。
 * @returns {Promise<Object>} 一个包含 Telegram 接口方法的对象。
 */
export async function createSimpleTelegramInterface(charAPI, ownerUsername, botCharname) {
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for SimpleTelegramInterface.')

	/**
	 * 获取简单的机器人配置模板。
	 * @returns {object} - 配置模板。
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerUserID: 'YOUR_TELEGRAM_USER_ID', // 用户需填写的 Telegram 数字 ID
			MaxMessageDepth: 20,                  // 默认聊天记录深度
			ReplyToAllMessages: false, // 若开启则对所有消息做出回复
			MediaGroupFlushMs: 550, // 相册（media_group）合并：收齐分片后的防抖等待毫秒数
		}
	}

	const DefaultParseModeOptions = { parse_mode: 'HTML' }
	const CAPTION_LENGTH_LIMIT = 1024
	const errorMessageText = '抱歉，处理您的消息时发生了错误。'

	/**
	 * 简单的 Telegram 机器人设置。
	 * @param {TelegrafInstance} bot - Telegraf 实例。
	 * @param {object} interfaceConfig - 接口配置。
	 */
	async function SimpleTelegramBotSetup(bot, interfaceConfig) {
		const botInfo = bot.botInfo || await tryFewTimes(() => bot.telegram.getMe())
		const botDisplayName = (await getPartInfo(charAPI, localhostLocales[0]))?.name || botCharname

		/** @type {Record<string, chatLogEntry_t_simple[]>} */
		const ChannelChatLogs = {}
		/** @type {Record<string, any>} */
		const ChannelCharScopedMemory = {}
		/**
		 * 缓存bot发送AI回复时，AI原始的回复对象。键是bot发出的Telegram消息ID。
		 * 此缓存用于在处理bot自身发出的消息时，恢复AI返回的附加数据(如extension)。
		 * @type {Record<number, ChatReply_t>}
		 */
		const aiReplyObjectCache = {}
		/** @type {Record<number, string>} 用户 ID → 显示名称 */
		const userDisplayNameCache = {}

		/** @type {Map<string, { messages: import('npm:telegraf/typings/core/types/typegram').Message[], logicalChannelId: string, ctx: TelegrafContext, timer: ReturnType<typeof setTimeout>|null }>} */
		const telegramMediaGroupBuffers = new Map()

		/**
		 * 将入站日志写入频道缓冲并按规则触发 `GetReply` 与 Telegram 发送。
		 * @param {TelegrafContext} ctx - 当前 Telegraf 上下文（相册 flush 时为该组最后一条分片的上下文）。
		 * @param {string} logicalChannelId - 逻辑频道 ID（chat 与 topic 拼接）。
		 * @param {import('./tools.mjs').chatLogEntry_t_simple | null} fountEntry - 已转换的聊天日志条目；为 null 时直接返回。
		 * @param {import('npm:telegraf/typings/core/types/typegram').Message[]} triggerMessages - 用于判断是否 @bot 等的原始 Telegram 消息列表（单条时为 `[ctx.message]`，相册为整组 batch）。
		 * @returns {Promise<void>}
		 */
		async function processAfterIncomingEntry(ctx, logicalChannelId, fountEntry, triggerMessages) {
			if (!fountEntry) return

			ChannelChatLogs[logicalChannelId] ??= []
			ChannelChatLogs[logicalChannelId].push(fountEntry)

			const maxDepth = interfaceConfig.MaxMessageDepth || 20
			while (ChannelChatLogs[logicalChannelId].length > maxDepth)
				ChannelChatLogs[logicalChannelId].shift()

			const triggerMsg = triggerMessages[triggerMessages.length - 1]

			let shouldReply = interfaceConfig.ReplyToAllMessages
			if (!shouldReply)
				if (ctx.chat.type === 'private')
					shouldReply = true
				else if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')
					outer: for (const msg of triggerMessages) {
						const originalMessageText = msg.text || msg.caption || ''
						if (botInfo.username && originalMessageText.toLowerCase().includes(`@${botInfo.username.toLowerCase()}`)) {
							shouldReply = true
							break
						}
						if (msg.reply_to_message?.from?.id === botInfo.id) {
							shouldReply = true
							break
						}
						const entityList = [...msg.entities || [], ...msg.caption_entities || []]
						for (const entity of entityList)
							if (entity.type === 'mention') {
								const mention = originalMessageText.substring(entity.offset, entity.offset + entity.length)
								if (mention.toLowerCase() === `@${botInfo.username?.toLowerCase()}`) {
									shouldReply = true
									break outer
								}
							}
					}


			if (!shouldReply) return

			try {
				await tryFewTimes(() => ctx.telegram.sendChatAction(ctx.chat.id, 'typing', {
					...triggerMsg.message_thread_id && { message_thread_id: triggerMsg.message_thread_id }
				}))

				/**
				 * 将角色侧中间回复发到 Telegram 并同步进 `ChannelChatLogs`。
				 * @param {ChatReply_t} replyFromChar - 角色返回的片段回复（含正文或文件）。
				 * @returns {Promise<null>} 恒为 null，与 CharAPI 中间件约定一致。
				 */
				const AddChatLogEntryViaCharAPI = async replyFromChar => {
					if (replyFromChar && (replyFromChar.content || replyFromChar.files?.length)) {
						const rawIntermediateMarkdown = replyFromChar.content_for_show || replyFromChar.content || ''
						const { cleanMarkdown: intermediateClean, stickerIds: intermediateStickerIds } = extractStickerIdsFromMarkdown(rawIntermediateMarkdown)
						let lastSentIntermediateMsg = null
						if (intermediateClean.trim()) {
							const htmlContent = aiMarkdownToTelegramHtml(intermediateClean)
							const textParts = splitTelegramReply(htmlContent)
							for (const part of textParts)
								lastSentIntermediateMsg = await tryFewTimes(() => ctx.telegram.sendMessage(
									ctx.chat.id,
									part,
									{
										...DefaultParseModeOptions,
										...triggerMsg.message_thread_id && { message_thread_id: triggerMsg.message_thread_id }
									}
								))
						}
						for (const stickerId of intermediateStickerIds) try {
							lastSentIntermediateMsg = await tryFewTimes(() => ctx.telegram.sendSticker(
								ctx.chat.id,
								stickerId,
								{
									...triggerMsg.message_thread_id && { message_thread_id: triggerMsg.message_thread_id }
								}
							))
						} catch (e) {
							console.error('[TelegramDefaultInterface] 发送中间回复贴纸失败:', e)
						}

						if (lastSentIntermediateMsg) {
							const fountEntryForBotReply = await TelegramMessageToFountChatLogEntry(ctx, { message: lastSentIntermediateMsg }, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname, undefined, userDisplayNameCache)
							if (fountEntryForBotReply) {
								ChannelChatLogs[logicalChannelId].push(fountEntryForBotReply)
								while (ChannelChatLogs[logicalChannelId].length > maxDepth) {
									const removed = ChannelChatLogs[logicalChannelId].shift()
									if (removed?.extension?.platform_message_ids?.[0] && aiReplyObjectCache[removed.extension.platform_message_ids[0]])
										delete aiReplyObjectCache[removed.extension.platform_message_ids[0]]
								}
							}
						}
					}
					return null
				}

				ChannelCharScopedMemory[logicalChannelId] ??= {}
				/**
				 * 解析惰性附件后组装传给 `GetReply` 的请求对象。
				 * @returns {Promise<object>} `chatReplyRequest_t` 形状的对象。
				 */
				const generateChatReplyRequest = async () => {
					for (const e of ChannelChatLogs[logicalChannelId])
						await resolveTelegramChatLogEntryFilesInPlace(e)
					return {
						supported_functions: { markdown: true, files: true, add_message: true },
						username: ownerUsername,
						chat_name: ctx.chat.type === 'private' ?
							`TG_DM_${logicalChannelId}` :
							`TG_Group_${ctx.chat.title || ctx.chat.id}${triggerMsg.message_thread_id ? `_Topic_${triggerMsg.message_thread_id}` : ''}`,
						char_id: botCharname,
						Charname: botDisplayName,
						UserCharname: ctx.from.first_name || ctx.from.username || `User_${ctx.from.id}`,
						ReplyToCharname: ctx.from.first_name || ctx.from.username || `User_${ctx.from.id}`,
						locales: localhostLocales,
						time: new Date(),
						world: null,
						user: await (async () => {
							const n = getAnyPreferredDefaultPart(ownerUsername, 'personas')
							if (n) return loadPart(ownerUsername, 'personas/' + n)
							return null
						})(),
						char: charAPI,
						other_chars: [],
						plugins: {},
						chat_scoped_char_memory: ChannelCharScopedMemory[logicalChannelId],
						chat_log: ChannelChatLogs[logicalChannelId].map(e => ({ ...e })),
						AddChatLogEntry: AddChatLogEntryViaCharAPI,
						/**
						 * 刷新请求快照（含最新 `chat_log` 与已解析附件）。
						 * @returns {Promise<object>} 与 {@link generateChatReplyRequest} 相同形状。
						 */
						Update: async () => await generateChatReplyRequest(),
						extension: {
							platform: 'telegram',
							trigger_message_id: triggerMsg.message_id,
							chat_id: ctx.chat.id,
							message_thread_id: triggerMsg.message_thread_id,
							user_id: ctx.from.id,
							username_tg: ctx.from.username,
							first_name_tg: ctx.from.first_name,
							last_name_tg: ctx.from.last_name,
							chat_type_tg: ctx.chat.type,
							chat_title_tg: ctx.chat.title,
							telegram_trigger_message_obj: triggerMsg
						}
					}
				}

				const aiFinalReply = await charAPI.interfaces.chat.GetReply(await generateChatReplyRequest())

				if (aiFinalReply && (aiFinalReply.content || aiFinalReply.content_for_show || aiFinalReply.files?.length)) {
					const rawAiMarkdown = aiFinalReply.content_for_show || aiFinalReply.content || ''
					const { cleanMarkdown: aiMarkdownContent, stickerIds } = extractStickerIdsFromMarkdown(rawAiMarkdown)
					const filesToProcess = (aiFinalReply.files || []).map(f => ({
						source: f.buffer,
						filename: f.name || 'file',
					}))

					let firstSentTelegramMessage = null
					const baseSendOptionsForReply = { ...DefaultParseModeOptions }

					if (filesToProcess.length) {
						let mainTextSentAsCaption = false
						for (let i = 0; i < filesToProcess.length; i++) {
							const fileItem = filesToProcess[i]
							const isLastFile = i === filesToProcess.length - 1
							let captionAiMarkdown = ''
							if (isLastFile && aiMarkdownContent.trim()) {
								captionAiMarkdown = aiMarkdownContent
								mainTextSentAsCaption = true
							}
							else if (filesToProcess.length === 1 && aiMarkdownContent.trim()) {
								captionAiMarkdown = aiMarkdownContent
								mainTextSentAsCaption = true
							}
							let finalHtmlCaption = captionAiMarkdown ? aiMarkdownToTelegramHtml(captionAiMarkdown) : undefined
							if (finalHtmlCaption && finalHtmlCaption.length > CAPTION_LENGTH_LIMIT) {
								console.warn(`[TelegramDefaultInterface] 文件 "${fileItem.filename}" 的HTML标题过长 (${finalHtmlCaption.length} > ${CAPTION_LENGTH_LIMIT})，尝试截断。`)
								const truncatedCaptionAiMarkdown = captionAiMarkdown.substring(0, Math.floor(CAPTION_LENGTH_LIMIT * 0.7)) + '...'
								finalHtmlCaption = aiMarkdownToTelegramHtml(truncatedCaptionAiMarkdown)
								if (finalHtmlCaption.length > CAPTION_LENGTH_LIMIT) {
									const plainTextCaption = captionAiMarkdown.substring(0, CAPTION_LENGTH_LIMIT - 10) + '...'
									finalHtmlCaption = escapeHTML(plainTextCaption)
									console.warn(`[TelegramDefaultInterface] 截断后HTML标题仍过长，使用纯文本回退: ${plainTextCaption.substring(0, 50)}...`)
								}
							}
							const sendOptionsWithCaption = { ...baseSendOptionsForReply, caption: finalHtmlCaption }
							let sentMsg
							try {
								if (fileItem.filename?.match(/\.(jpeg|jpg|png|gif|webp)$/i))
									sentMsg = await tryFewTimes(() => ctx.replyWithPhoto({ source: fileItem.source, filename: fileItem.filename }, sendOptionsWithCaption))
								else if (fileItem.filename?.match(/\.(mp3|ogg|wav|m4a)$/i))
									sentMsg = await tryFewTimes(() => ctx.replyWithAudio({ source: fileItem.source, filename: fileItem.filename }, { ...sendOptionsWithCaption, title: fileItem.filename }))
								else if (fileItem.filename?.match(/\.(mp4|mov|avi|mkv)$/i))
									sentMsg = await tryFewTimes(() => ctx.replyWithVideo({ source: fileItem.source, filename: fileItem.filename }, sendOptionsWithCaption))
								else
									sentMsg = await tryFewTimes(() => ctx.replyWithDocument({ source: fileItem.source, filename: fileItem.filename }, sendOptionsWithCaption))
							}
							catch (e) {
								console.error(`[TelegramDefaultInterface] 发送文件 ${fileItem.filename} 失败:`, e)
								try {
									sentMsg = await tryFewTimes(() => ctx.replyWithDocument({ source: fileItem.source, filename: fileItem.filename }, sendOptionsWithCaption))
								}
								catch (e2) {
									console.error(`[TelegramDefaultInterface] 作为文档发送 ${fileItem.filename} 也失败:`, e2)
									const fallbackText = `[文件发送失败: ${fileItem.filename}]${captionAiMarkdown ? '\n' + captionAiMarkdown : ''}`.trim()
									if (fallbackText) try {
										sentMsg = await tryFewTimes(() => ctx.reply(escapeHTML(fallbackText.substring(0, 4000)), baseSendOptionsForReply))
									} catch (e3) {
										console.error('[TelegramDefaultInterface] 发送文件失败的回退消息也失败:', e3)
									}
								}
							}
							if (sentMsg && !firstSentTelegramMessage) firstSentTelegramMessage = sentMsg
						}
						if (!mainTextSentAsCaption && aiMarkdownContent.trim()) {
							const htmlContent = aiMarkdownToTelegramHtml(aiMarkdownContent)
							const textParts = splitTelegramReply(htmlContent)
							for (const part of textParts) try {
								const sentMsg = await tryFewTimes(() => ctx.reply(part, baseSendOptionsForReply))
								if (sentMsg && !firstSentTelegramMessage) firstSentTelegramMessage = sentMsg
							} catch (e) { console.error('[TelegramDefaultInterface] 发送剩余HTML文本失败:', e) }
						}
					}
					else if (aiMarkdownContent.trim()) {
						const htmlContent = aiMarkdownToTelegramHtml(aiMarkdownContent)
						const textParts = splitTelegramReply(htmlContent)
						for (const part of textParts) try {
							const sentMsg = await tryFewTimes(() => ctx.reply(part, baseSendOptionsForReply))
							if (sentMsg && !firstSentTelegramMessage) firstSentTelegramMessage = sentMsg
						} catch (e) { console.error('[TelegramDefaultInterface] 发送HTML文本消息失败:', e) }
					}

					const stickerSendOptions = {
						...triggerMsg.message_thread_id && { message_thread_id: triggerMsg.message_thread_id }
					}
					for (const stickerId of stickerIds) try {
						const sentMsg = await tryFewTimes(() => ctx.telegram.sendSticker(ctx.chat.id, stickerId, stickerSendOptions))
						if (sentMsg && !firstSentTelegramMessage) firstSentTelegramMessage = sentMsg
					} catch (e) {
						console.error('[TelegramDefaultInterface] 发送贴纸消息失败:', e)
					}

					if (firstSentTelegramMessage && aiFinalReply) {
						aiReplyObjectCache[firstSentTelegramMessage.message_id] = aiFinalReply

						const fountEntryForBotReply = await TelegramMessageToFountChatLogEntry(ctx, { message: firstSentTelegramMessage }, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname, aiReplyObjectCache)

						if (fountEntryForBotReply) {
							ChannelChatLogs[logicalChannelId].push(fountEntryForBotReply)
							while (ChannelChatLogs[logicalChannelId].length > maxDepth) {
								const removed = ChannelChatLogs[logicalChannelId].shift()
								if (removed?.extension?.platform_message_ids?.[0] && aiReplyObjectCache[removed.extension.platform_message_ids[0]])
									delete aiReplyObjectCache[removed.extension.platform_message_ids[0]]
							}
						}
					}
				}
			}
			catch (error) {
				console.error(`[TelegramDefaultInterface] 处理消息并回复时出错 (chat ${logicalChannelId}, message ${triggerMsg.message_id}):`, error)
				console.error('[TelegramDefaultInterface] 错误堆栈:', error.stack)
				try {
					await tryFewTimes(() => ctx.reply(escapeHTML(errorMessageText)))
				} catch (replyError) {
					console.error('[TelegramDefaultInterface] 发送错误消息也失败:', replyError)
				}
			}
		}

		/**
		 * 重置相册合并防抖定时器，到期后调用 `flushTelegramMediaGroup`。
		 * @param {{ messages: import('npm:telegraf/typings/core/types/typegram').Message[], logicalChannelId: string, ctx: TelegrafContext, timer: ReturnType<typeof setTimeout>|null }} state - 当前缓冲状态。
		 * @param {string} bufferKey - 与 `telegramMediaGroupBuffers` 中键一致。
		 * @returns {void}
		 */
		function scheduleMediaGroupFlush(state, bufferKey) {
			if (state.timer)
				clearTimeout(state.timer)
			state.timer = setTimeout(() => {
				state.timer = null
				flushTelegramMediaGroup(bufferKey)
			}, interfaceConfig.MediaGroupFlushMs ?? 550)
		}

		/**
		 * 将当前缓冲的相册分片合并为一条日志并交给 `processAfterIncomingEntry`。
		 * @param {string} bufferKey - `botId:logicalChannelId:media_group_id`。
		 * @returns {Promise<void>}
		 */
		async function flushTelegramMediaGroup(bufferKey) {
			const state = telegramMediaGroupBuffers.get(bufferKey)
			if (!state) return
			const batch = [...state.messages]
			state.messages.length = 0
			try {
				const mergedCtx = state.ctx
				const fountEntry = await telegramMediaGroupMessagesToFountChatLogEntry(
					mergedCtx, batch, botInfo, interfaceConfig, charAPI, botCharname, aiReplyObjectCache, userDisplayNameCache)
				await processAfterIncomingEntry(mergedCtx, state.logicalChannelId, fountEntry, batch)
				if (state.messages.length)
					scheduleMediaGroupFlush(state, bufferKey)
				else
					telegramMediaGroupBuffers.delete(bufferKey)
			}
			catch (e) {
				console.error('[TelegramDefaultInterface] flushTelegramMediaGroup failed:', e)
				state.messages = [...batch, ...state.messages]
				scheduleMediaGroupFlush(state, bufferKey)
			}
		}

		bot.on('edited_message', async ctx_generic => {
			/** @type {import('npm:telegraf').NarrowedContext<TelegrafContext, import('npm:telegraf').Types.Update.EditedMessageUpdate>} */
			const ctx = ctx_generic
			if (!ctx.update?.edited_message) return

			const editedMessage = ctx.update.edited_message
			const logicalChannelId = constructLogicalChannelIdForDefault(editedMessage.chat.id, editedMessage.message_thread_id)

			if (editedMessage.chat.type === 'private' && String(editedMessage.from?.id) !== String(interfaceConfig.OwnerUserID))
				return
			if (editedMessage.from?.is_bot) return

			if (editedMessage.media_group_id) {
				const bufferKey = `${botInfo.id}:${logicalChannelId}:${editedMessage.media_group_id}`
				const state = telegramMediaGroupBuffers.get(bufferKey)
				if (state) {
					const idx = state.messages.findIndex(m => m.message_id === editedMessage.message_id)
					if (idx >= 0) state.messages[idx] = editedMessage
					else state.messages.push(editedMessage)
					state.ctx = ctx
					scheduleMediaGroupFlush(state, bufferKey)
					return
				}
			}

			const channelLogs = ChannelChatLogs[logicalChannelId]
			if (!channelLogs) return

			const fountEntry = await TelegramMessageToFountChatLogEntry(ctx, { message: editedMessage }, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname, aiReplyObjectCache, userDisplayNameCache)
			if (!fountEntry) return

			applyTelegramMessageUpdateToChannelLog(channelLogs, fountEntry)
		})

		bot.on('message', async ctx_generic => {
			/** @type {import('npm:telegraf').NarrowedContext<TelegrafContext, import('npm:telegraf').Types.Update.MessageUpdate>} */
			const ctx = ctx_generic
			const logicalChannelId = constructLogicalChannelIdForDefault(ctx.chat.id, ctx.message.message_thread_id)

			if (ctx.chat.type === 'private' && String(ctx.from.id) !== String(interfaceConfig.OwnerUserID))
				return
			if (ctx.from.is_bot) return

			if (ctx.message.media_group_id) {
				const bufferKey = `${botInfo.id}:${logicalChannelId}:${ctx.message.media_group_id}`
				let state = telegramMediaGroupBuffers.get(bufferKey)
				if (!state) {
					state = { messages: [], logicalChannelId, ctx, timer: null }
					telegramMediaGroupBuffers.set(bufferKey, state)
				}
				state.ctx = ctx
				if (!state.messages.some(m => m.message_id === ctx.message.message_id))
					state.messages.push(ctx.message)
				scheduleMediaGroupFlush(state, bufferKey)
				return
			}

			const fountEntry = await TelegramMessageToFountChatLogEntry(ctx, ctx, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname, aiReplyObjectCache, userDisplayNameCache)
			await processAfterIncomingEntry(ctx, logicalChannelId, fountEntry, [ctx.message])
		})

		bot.catch((err, ctx_err) => {
			console.error(`[TelegramDefaultInterface] Telegraf error for update ${ctx_err.updateType || 'unknown'}:`, err, ctx_err)
		})
	}

	return {
		/**
		 * 设置 Telegram Bot 实例。
		 * @param {TelegrafInstance} bot - Telegram Bot 实例。
		 * @param {object} config - Bot 配置。
		 */
		BotSetup: async (bot, config) => {
			charBotRegistry[ownerUsername] ??= {}
			charBotRegistry[ownerUsername][botCharname] = bot
			await SimpleTelegramBotSetup(bot, config)
		},
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
