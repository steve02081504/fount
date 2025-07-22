import {
	TelegramMessageToFountChatLogEntry,
	splitTelegramReply,
	aiMarkdownToTelegramHtml,
	escapeHTML
} from './tools.mjs'
import { localhostLocales } from '../../../../../../scripts/i18n.mjs'
import { getPartInfo } from '../../../../../../scripts/locale.mjs'
import { loadDefaultPersona } from '../../../../../../server/managers/persona_manager.mjs'

/** @typedef {import('npm:telegraf').Telegraf} TelegrafInstance */
/** @typedef {import('npm:telegraf').Context} TelegrafContext */
/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/** @typedef {import('./tools.mjs').chatLogEntry_t_simple} chatLogEntry_t_simple */
/** @typedef {import('../../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */

/**
 * 重试函数
 * @async
 * @param {Function} func - 要执行的异步函数。
 * @param {{times?: number, WhenFailsWaitFor?: number}} [options] - 重试选项。
 * @returns {Promise<any>}
 */
async function tryFewTimes(func, { times = 3, WhenFailsWaitFor = 2000 } = {}) {
	let lastError
	for (let i = 0; i < times; i++)
		try {
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
	if (threadId !== undefined && threadId !== null)
		return `${chatId}_${threadId}`

	return String(chatId)
}


/**
 * 为没有自定义 Telegram 接口的角色创建一个简单的默认 Telegram 接口。
 * @param {CharAPI_t} charAPI - 角色的 API 对象。
 * @param {string} ownerUsername - Fount 系统的用户名。
 * @param {string} botCharname - 当前机器人绑定的角色名称。
 * @returns {Promise<Object>} 一个包含 Telegram 接口方法的对象。
 */
export async function createSimpleTelegramInterface(charAPI, ownerUsername, botCharname) {
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for SimpleTelegramInterface.')

	function GetSimpleBotConfigTemplate() {
		return {
			OwnerUserID: 'YOUR_TELEGRAM_USER_ID', // 用户需填写的 Telegram 数字 ID
			MaxMessageDepth: 20,                   // 默认聊天记录深度
		}
	}

	const DefaultParseModeOptions = { parse_mode: 'HTML' }
	const CAPTION_LENGTH_LIMIT = 1024
	const errorMessageText = '抱歉，处理您的消息时发生了错误。'

	async function SimpleTelegramBotSetup(bot, interfaceConfig) {
		const botInfo = bot.botInfo || await tryFewTimes(() => bot.telegram.getMe())
		const botDisplayName = (await getPartInfo(charAPI, localhostLocales[0]))?.name || botCharname

		/** @type {Record<string, chatLogEntry_t_simple[]>} */
		const ChannelChatLogs = {}
		/** @type {Record<string, any>} */
		const ChannelCharScopedMemory = {}
		/**
		 * @type {Record<number, ChatReply_t>}
		 * 缓存机器人发送AI回复时，AI原始的回复对象。键是机器人发出的Telegram消息ID。
		 * 此缓存用于在处理机器人自身发出的消息时，恢复AI返回的附加数据(如extension)。
		 */
		const aiReplyObjectCache = {}

		bot.on('message', async (ctx_generic) => {
			/** @type {import('npm:telegraf').NarrowedContext<TelegrafContext, import('npm:telegraf').Types.Update.MessageUpdate>} */
			const ctx = ctx_generic
			const logicalChannelId = constructLogicalChannelIdForDefault(ctx.chat.id, ctx.message.message_thread_id)

			if (ctx.chat.type === 'private' && String(ctx.from.id) !== String(interfaceConfig.OwnerUserID)) {
				console.log(`[TelegramDefaultInterface] Ignoring private message from non-owner ${ctx.from.id} in chat ${logicalChannelId}`)
				return
			}
			if (ctx.from.is_bot) return

			const fountEntry = await TelegramMessageToFountChatLogEntry(ctx, ctx, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname, aiReplyObjectCache)
			if (!fountEntry) return

			ChannelChatLogs[logicalChannelId] ??= []
			ChannelChatLogs[logicalChannelId].push(fountEntry)

			const maxDepth = interfaceConfig.MaxMessageDepth || 20
			while (ChannelChatLogs[logicalChannelId].length > maxDepth)
				ChannelChatLogs[logicalChannelId].shift()

			let shouldReply = false
			if (ctx.chat.type === 'private')
				shouldReply = true
			else if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
				const originalMessageText = ctx.message.text || ctx.message.caption || ''
				if (botInfo.username && originalMessageText.toLowerCase().includes(`@${botInfo.username.toLowerCase()}`))
					shouldReply = true

				if (!shouldReply && ctx.message.reply_to_message && ctx.message.reply_to_message.from.id === botInfo.id)
					shouldReply = true

				if (!shouldReply && ctx.message.entities)
					for (const entity of ctx.message.entities)
						if (entity.type === 'mention') {
							const mention = originalMessageText.substring(entity.offset, entity.offset + entity.length)
							if (mention.toLowerCase() === `@${botInfo.username?.toLowerCase()}`) {
								shouldReply = true
								break
							}
						}
			}
			if (!shouldReply) return

			try {
				await tryFewTimes(() => ctx.telegram.sendChatAction(ctx.chat.id, 'typing', {
					...ctx.message.message_thread_id && { message_thread_id: ctx.message.message_thread_id }
				}))

				const AddChatLogEntryViaCharAPI = async (replyFromChar) => {
					if (replyFromChar && (replyFromChar.content || replyFromChar.files?.length)) {
						const aiMarkdownContent = replyFromChar.content || ''
						if (aiMarkdownContent.trim()) {
							const htmlContent = aiMarkdownToTelegramHtml(aiMarkdownContent)
							const textParts = splitTelegramReply(htmlContent)
							let lastSentIntermediateMsg = null
							for (const part of textParts)
								lastSentIntermediateMsg = await tryFewTimes(() => ctx.telegram.sendMessage(
									ctx.chat.id, // 目标群组/私聊ID
									part,
									{ // 发送选项
										...DefaultParseModeOptions,
										// 确保中间消息也发送到正确的 thread (如果原始消息在 thread 中)
										...ctx.message.message_thread_id && { message_thread_id: ctx.message.message_thread_id }
									}
								))

							if (lastSentIntermediateMsg) {
								const fountEntryForBotReply = await TelegramMessageToFountChatLogEntry(ctx, { message: lastSentIntermediateMsg }, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname)
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
					return null
				}

				ChannelCharScopedMemory[logicalChannelId] ??= {}
				const generateChatReplyRequest = () => ({
					supported_functions: { markdown: true, files: true, add_message: true, html: false, unsafe_html: false },
					username: ownerUsername,
					// chat_name 可以包含分区信息
					chat_name: ctx.chat.type === 'private' ?
						`TG_DM_${logicalChannelId}` :
						`TG_Group_${ctx.chat.title || ctx.chat.id}${ctx.message.message_thread_id ? `_Topic_${ctx.message.message_thread_id}` : ''}`,
					char_id: botCharname,
					Charname: botDisplayName,
					UserCharname: ctx.from.first_name || ctx.from.username || `User_${ctx.from.id}`,
					ReplyToCharname: ctx.from.first_name || ctx.from.username || `User_${ctx.from.id}`,
					locales: localhostLocales,
					time: new Date(), world: null, user: loadDefaultPersona(ownerUsername), char: charAPI, other_chars: [], plugins: {},
					chat_scoped_char_memory: ChannelCharScopedMemory[logicalChannelId],
					chat_log: ChannelChatLogs[logicalChannelId].map(e => ({ ...e })),
					AddChatLogEntry: AddChatLogEntryViaCharAPI,
					Update: async () => generateChatReplyRequest(),
					extension: {
						platform: 'telegram',
						trigger_message_id: ctx.message.message_id,
						chat_id: ctx.chat.id, // 原始 chat.id
						message_thread_id: ctx.message.message_thread_id, // 原始 thread_id
						user_id: ctx.from.id,
						username_tg: ctx.from.username,
						first_name_tg: ctx.from.first_name,
						last_name_tg: ctx.from.last_name,
						chat_type_tg: ctx.chat.type,
						chat_title_tg: ctx.chat.title,
						telegram_trigger_message_obj: ctx.message
					}
				})

				const aiFinalReply = await charAPI.interfaces.chat.GetReply(generateChatReplyRequest())

				if (aiFinalReply && (aiFinalReply.content || aiFinalReply.files?.length)) {
					const aiMarkdownContent = aiFinalReply.content || ''
					const filesToProcess = (aiFinalReply.files || []).map(f => ({
						source: f.buffer,
						filename: f.name || 'file',
					}))

					let firstSentTelegramMessage = null
					// ctx.reply() 会自动回复到原始消息，并继承 message_thread_id (如果存在)
					const baseSendOptionsForReply = {
						...DefaultParseModeOptions,
						// Telegraf 的 ctx.reply 自动处理 reply_to_message_id 和 message_thread_id
					}

					if (filesToProcess.length > 0) {
						let mainTextSentAsCaption = false
						for (let i = 0; i < filesToProcess.length; i++) {
							const fileItem = filesToProcess[i]
							const isLastFile = i === filesToProcess.length - 1
							let captionAiMarkdown = ''
							if (isLastFile && aiMarkdownContent.trim()) {
								captionAiMarkdown = aiMarkdownContent
								mainTextSentAsCaption = true
							} else if (filesToProcess.length === 1 && aiMarkdownContent.trim()) {
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
								// 使用 ctx.replyWithPhoto, ctx.replyWithAudio 等，它们会自动处理回复和分区
								if (fileItem.filename?.match(/\.(jpeg|jpg|png|gif|webp)$/i))
									sentMsg = await tryFewTimes(() => ctx.replyWithPhoto({ source: fileItem.source, filename: fileItem.filename }, sendOptionsWithCaption))
								else if (fileItem.filename?.match(/\.(mp3|ogg|wav|m4a)$/i))
									sentMsg = await tryFewTimes(() => ctx.replyWithAudio({ source: fileItem.source, filename: fileItem.filename }, { ...sendOptionsWithCaption, title: fileItem.filename }))
								else if (fileItem.filename?.match(/\.(mp4|mov|avi|mkv)$/i))
									sentMsg = await tryFewTimes(() => ctx.replyWithVideo({ source: fileItem.source, filename: fileItem.filename }, sendOptionsWithCaption))
								else
									sentMsg = await tryFewTimes(() => ctx.replyWithDocument({ source: fileItem.source, filename: fileItem.filename }, sendOptionsWithCaption))
							} catch (e) {
								console.error(`[TelegramDefaultInterface] 发送文件 ${fileItem.filename} 失败:`, e)
								const fallbackText = `[文件发送失败: ${fileItem.filename}] ${captionAiMarkdown || ''}`.trim()
								if (fallbackText)
									try {
										// ctx.reply 的第二个参数是 Extra
										sentMsg = await tryFewTimes(() => ctx.reply(escapeHTML(fallbackText.substring(0, 4000)), baseSendOptionsForReply))
									} catch (e2) { console.error('[TelegramDefaultInterface] 发送文件失败的回退消息也失败:', e2) }
							}
							if (sentMsg && !firstSentTelegramMessage) firstSentTelegramMessage = sentMsg
						}
						if (!mainTextSentAsCaption && aiMarkdownContent.trim()) {
							const htmlContent = aiMarkdownToTelegramHtml(aiMarkdownContent)
							const textParts = splitTelegramReply(htmlContent)
							for (const part of textParts)
								try {
									const sentMsg = await tryFewTimes(() => ctx.reply(part, baseSendOptionsForReply))
									if (sentMsg && !firstSentTelegramMessage) firstSentTelegramMessage = sentMsg
								} catch (e) { console.error('[TelegramDefaultInterface] 发送剩余HTML文本失败:', e) }
						}
					} else if (aiMarkdownContent.trim()) {
						const htmlContent = aiMarkdownToTelegramHtml(aiMarkdownContent)
						const textParts = splitTelegramReply(htmlContent)
						for (const part of textParts)
							try {
								const sentMsg = await tryFewTimes(() => ctx.reply(part, baseSendOptionsForReply))
								if (sentMsg && !firstSentTelegramMessage) firstSentTelegramMessage = sentMsg
							} catch (e) { console.error('[TelegramDefaultInterface] 发送HTML文本消息失败:', e) }
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
			} catch (error) {
				console.error(`[TelegramDefaultInterface] 处理消息并回复时出错 (chat ${logicalChannelId}):`, error)
				await tryFewTimes(() => ctx.reply(escapeHTML(errorMessageText)))
			}
		})

		bot.catch((err, ctx_err) => {
			console.error(`[TelegramDefaultInterface] Telegraf error for update ${ctx_err.updateType || 'unknown'}:`, err, ctx_err)
		})
	}

	return {
		BotSetup: SimpleTelegramBotSetup,
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
