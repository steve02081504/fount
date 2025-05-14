// Markup from telegraf is not used in this version, can be removed if not needed elsewhere.
// import { Markup } from 'npm:telegraf@^4.16.3'
import { TelegramMessageToFountChatLogEntry, splitTelegramReply } from './tools.mjs'
import { localhostLocales, geti18n } from '../../../../../../scripts/i18n.mjs'
import { getPartInfo } from '../../../../../../scripts/locale.mjs'

/** @typedef {import('npm:telegraf').Telegraf} TelegrafInstance */
/** @typedef {import('npm:telegraf').Context} TelegrafContext */
/** @typedef {import('../../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/**
 * @typedef { (FountChatLogEntryBase & {
 *  extension?: {telegram_message_id?: number, telegram_chat_id?: number, telegram_user_id?: number, [key: string]: any }
 * })} chatLogEntry_t_simple
 */
/** @typedef {import('../../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */


// 辅助函数：尝试几次执行异步函数
async function tryFewTimes(func, { times = 3, WhenFailsWaitFor = 2000 } = {}) {
	let lastError
	for (let i = 0; i < times; i++)
		try {
			return await func()
		} catch (error) {
			lastError = error
			// 避免在重试日志中再次触发 MarkdownV2 解析错误 (如果错误消息本身包含特殊字符)
			console.warn(`[TelegramDefaultInterface] tryFewTimes: Attempt ${i + 1} failed. Error: ${error.message?.replace(/([!#()*+.=>[\]_`{|}~\-])/g, '\\$1')}`)
			if (i < times - 1) await new Promise(resolve => setTimeout(resolve, WhenFailsWaitFor))
		}

	console.error(`[TelegramDefaultInterface] tryFewTimes: All ${times} attempts failed. Last error:`, lastError)
	throw lastError
}

/**
 * 转义 MarkdownV2 的特殊字符。
 * @param {string} text 要转义的文本。
 * @returns {string} 转义后的文本。
 */
function escapeMarkdownV2(text) {
	if (typeof text !== 'string' || !text) return ''
	// Telegram MarkdownV2 需要转义的字符: _ * [ ] ( ) ~ ` > # + - = | { } . !
	return text.replace(/([!#()*+.=>[\]_`{|}~\-])/g, '\\$1')
}


/**
 * 为没有自定义 Telegram 接口的角色创建一个简单的默认 Telegram 接口。
 * @param {charAPI_t} charAPI - 角色的 API 对象。
 * @param {string} ownerUsername - Fount 系统的用户名 (用于日志和可能的权限检查)。
 * @param {string} botCharname - 当前机器人绑定的角色名称。
 * @returns {Promise<Object>} 一个包含 Telegram 接口方法的对象。
 */
export async function createSimpleTelegramInterface(charAPI, ownerUsername, botCharname) {
	// 检查角色是否具备基本的聊天能力
	if (!charAPI?.interfaces?.chat?.GetReply)
		throw new Error('charAPI.interfaces.chat.GetReply is required for SimpleTelegramInterface.')


	/**
	 * 获取此默认接口的配置模板。
	 */
	function GetSimpleBotConfigTemplate() {
		return {
			OwnerUserID: 'YOUR_TELEGRAM_USER_ID', // Telegram 用户的数字 ID
			MaxMessageDepth: 20, // 历史消息数量
			// 注意：您移除了命令、欢迎/帮助消息和 ParseMode 的配置。
			// 如果需要这些功能，可以将它们加回到这里和后续的逻辑中。
		}
	}

	// 固定使用 MarkdownV2。如果需要用户配置，应从 interfaceConfig 读取。
	const DefaultParseModeOptions = { parse_mode: 'MarkdownV2' }

	/**
	 * Telegram Bot 的核心设置和事件处理函数。
	 */
	async function SimpleTelegramBotSetup(bot, interfaceConfig, fountUsername, currentBotName) {
		const botInfo = bot.botInfo || await tryFewTimes(() => bot.telegram.getMe())
		const botDisplayName = (await getPartInfo(charAPI, localhostLocales[0]))?.name || botCharname // 尝试获取本地化名称

		/** @type {Record<number, chatLogEntry_t_simple[]>} */
		const ChannelChatLogs = {}
		/** @type {Record<number, any>} */
		const ChannelCharScopedMemory = {}
		/** @type {Record<number, ChatReply_t>} */
		const aiReplyObjectCache = {}


		bot.on('message', async (ctx_generic) => {
			/** @type {import('npm:telegraf').NarrowedContext<TelegrafContext, import('npm:telegraf').Types.Update.MessageUpdate>} */
			const ctx = ctx_generic

			if (ctx.chat.type === 'private' && String(ctx.from.id) !== String(interfaceConfig.OwnerUserID)) {
				console.log(`[TelegramDefaultInterface] Ignoring private message from non-owner ${ctx.from.id} in chat ${ctx.chat.id}`)
				return
			}
			if (ctx.from.is_bot) return

			const fountEntry = await TelegramMessageToFountChatLogEntry(ctx, ctx, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname)
			if (!fountEntry) return

			ChannelChatLogs[ctx.chat.id] ??= []
			ChannelChatLogs[ctx.chat.id].push(fountEntry)

			const maxDepth = interfaceConfig.MaxMessageDepth || 20
			while (ChannelChatLogs[ctx.chat.id].length > maxDepth) {
				const removedEntry = ChannelChatLogs[ctx.chat.id].shift()
				if (removedEntry?.extension?.telegram_message_id && aiReplyObjectCache[removedEntry.extension.telegram_message_id])
					delete aiReplyObjectCache[removedEntry.extension.telegram_message_id]

			}

			let shouldReply = false
			if (ctx.chat.type === 'private')
				shouldReply = true
			else if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
				const messageText = ctx.message.text || ctx.message.caption || ''
				if (messageText.includes(`@${botInfo.username}`)) shouldReply = true
				if (ctx.message.entities)
					for (const entity of ctx.message.entities)
						if (entity.type === 'mention') {
							const mention = messageText.substring(entity.offset, entity.offset + entity.length)
							if (mention === `@${botInfo.username}`) {
								shouldReply = true
								break
							}
						}


				if (ctx.message.reply_to_message && ctx.message.reply_to_message.from.id === botInfo.id)
					shouldReply = true

			}
			if (!shouldReply) return

			try {
				await tryFewTimes(() => ctx.sendChatAction('typing'))

				async function sendAndCache(currentCtx, payload, originalAIReply) {
					let sentTgMessage = null
					const parseModeOpts = DefaultParseModeOptions // 使用固定的解析模式

					if (typeof payload === 'string')
						sentTgMessage = await tryFewTimes(() => currentCtx.reply(escapeMarkdownV2(payload), parseModeOpts))
					else if (payload.files && payload.files.length > 0) {
						for (let i = 0; i < payload.files.length; i++) {
							const fileItem = payload.files[i]
							const isLastFile = i === payload.files.length - 1
							const caption = fileItem.caption || (isLastFile ? payload.text : undefined)
							let escapedCaption = caption ? escapeMarkdownV2(caption) : undefined

							if (escapedCaption && escapedCaption.length > 1024) {
								const captionParts = splitTelegramReply(escapedCaption, 1000)
								for (const part of captionParts)
									await tryFewTimes(() => currentCtx.reply(part, parseModeOpts))

								escapedCaption = undefined
							}

							const sendOptions = { caption: escapedCaption, ...parseModeOpts }

							if (fileItem.filename?.match(/\.(jpeg|jpg|png|gif|webp)$/i))
								sentTgMessage = await tryFewTimes(() => currentCtx.replyWithPhoto({ source: fileItem.source, filename: fileItem.filename }, sendOptions))
							else if (fileItem.filename?.match(/\.(mp3|ogg|wav|m4a)$/i))
								sentTgMessage = await tryFewTimes(() => currentCtx.replyWithAudio({ source: fileItem.source, filename: fileItem.filename }, { ...sendOptions, title: fileItem.filename }))
							else if (fileItem.filename?.match(/\.(mp4|mov|avi|mkv)$/i))
								sentTgMessage = await tryFewTimes(() => currentCtx.replyWithVideo({ source: fileItem.source, filename: fileItem.filename }, sendOptions))
							else
								sentTgMessage = await tryFewTimes(() => currentCtx.replyWithDocument({ source: fileItem.source, filename: fileItem.filename }, sendOptions))

							// 如果不是最后一个文件，即使发送成功，sentTgMessage 也会被下一次循环覆盖。
							// 我们主要关心的是 *与originalAIReply关联的* 那个消息。
							// Telegraf 的 sendMediaGroup 可能更适合多个文件，但它有自己的限制。
							// 为简单起见，当前逻辑是将 originalAIReply 与 *最后一个* 成功发送的消息（或文本）关联。
							if (!isLastFile) sentTgMessage = null // 重置，确保只有最后的消息可能被缓存
						}
						// 如果文件发送完毕后，仍有主文本内容且之前未作为caption发送 (或者所有文件都没有caption)
						const mainTextAfterFiles = payload.text
						const lastFileHadCaption = payload.files[payload.files.length - 1].caption
						const sentMessageWasFileWithCaption = sentTgMessage && sentTgMessage.caption

						if (mainTextAfterFiles && !lastFileHadCaption && !sentMessageWasFileWithCaption) {
							const tempMsg = await tryFewTimes(() => currentCtx.reply(escapeMarkdownV2(mainTextAfterFiles), parseModeOpts))
							if (!sentTgMessage) sentTgMessage = tempMsg // 如果前面没有发送任何带 originalAIReply 的消息
						}


					} else if (payload.text)
						sentTgMessage = await tryFewTimes(() => currentCtx.reply(escapeMarkdownV2(payload.text), parseModeOpts))


					if (sentTgMessage && originalAIReply)
						aiReplyObjectCache[sentTgMessage.message_id] = originalAIReply

					return sentTgMessage // 返回最后发送的消息，可能为 null
				}

				const AddChatLogEntry = async (replyFromChar) => {
					if (replyFromChar && (replyFromChar.content || replyFromChar.files?.length)) {
						const textContent = replyFromChar.content || ''
						const filesToSend = (replyFromChar.files || []).map(f => ({
							source: f.buffer,
							filename: f.name || 'file',
							// caption 由 sendAndCache 根据 textContent 和是否为最后一个文件来决定
						}))

						if (!textContent && filesToSend.length === 0) return null

						const splitTexts = splitTelegramReply(textContent) // 分割原始文本

						if (splitTexts.length === 0 && filesToSend.length > 0)
							await sendAndCache(ctx, { files: filesToSend }, replyFromChar) // text 为空
						else
							for (let i = 0; i < splitTexts.length; i++) {
								const currentTextPart = splitTexts[i] // 未转义的文本片段
								const isLastTextPart = i === splitTexts.length - 1
								await sendAndCache(ctx, {
									text: currentTextPart,
									files: isLastTextPart ? filesToSend : []
								}, isLastTextPart ? replyFromChar : undefined)
							}

					}
					return null
				}

				ChannelCharScopedMemory[ctx.chat.id] ??= {}
				const generateChatReplyRequest = () => ({
					supported_functions: { markdown: true, files: true, add_message: true },
					username: ownerUsername, // Fount 用户名
					chat_name: ctx.chat.type === 'private' ? `TG_DM_${ctx.chat.id}` : `TG_Group_${ctx.chat.title || ctx.chat.id}`,
					char_id: botCharname,
					Charname: botDisplayName,
					UserCharname: ctx.from.first_name || ctx.from.username || `User_${ctx.from.id}`,
					ReplyToCharname: ctx.from.first_name || ctx.from.username || `User_${ctx.from.id}`,
					locales: localhostLocales,
					time: new Date(), world: null, user: null, char: charAPI, other_chars: [], plugins: {},
					chat_scoped_char_memory: ChannelCharScopedMemory[ctx.chat.id],
					chat_log: ChannelChatLogs[ctx.chat.id].map(e => ({ ...e })),
					AddChatLogEntry,
					Update: async () => generateChatReplyRequest(),
					extension: {
						platform: 'telegram', trigger_message_id: ctx.message.message_id,
						chat_id: ctx.chat.id, user_id: ctx.from.id,
						username_tg: ctx.from.username, first_name_tg: ctx.from.first_name,
						last_name_tg: ctx.from.last_name, chat_type_tg: ctx.chat.type,
						chat_title_tg: ctx.chat.title
					}
				})

				const aiFinalReply = await charAPI.interfaces.chat.GetReply(generateChatReplyRequest())

				if (aiFinalReply && (aiFinalReply.content || aiFinalReply.files?.length)) {
					const textContent = aiFinalReply.content || ''
					const filesToSend = (aiFinalReply.files || []).map(f => ({
						source: f.buffer,
						filename: f.name || 'file',
					}))

					if (!textContent && filesToSend.length === 0) { /* no-op */ }
					else {
						const splitTexts = splitTelegramReply(textContent)
						if (splitTexts.length === 0 && filesToSend.length > 0)
							await sendAndCache(ctx, { files: filesToSend }, aiFinalReply)
						else
							for (let i = 0; i < splitTexts.length; i++) {
								const currentTextPart = splitTexts[i]
								const isLastTextPart = i === splitTexts.length - 1
								await sendAndCache(ctx, {
									text: currentTextPart,
									files: isLastTextPart ? filesToSend : []
								}, isLastTextPart ? aiFinalReply : undefined)
							}

					}
				}
			} catch (error) {
				console.error(`[TelegramDefaultInterface] Error processing message and replying in chat ${ctx.chat.id}:`, error)
				try {
					const errorMessage = await geti18n('telegram_bots.errors.replyFailed', { error: error.message })
					await tryFewTimes(() => ctx.reply(escapeMarkdownV2(errorMessage), DefaultParseModeOptions)) // 错误消息也需要转义
				} catch (sendError) {
					console.error(`[TelegramDefaultInterface] Failed to send error notification to chat ${ctx.chat.id}:`, sendError)
				}
			}
		})

		bot.catch((err, ctx_err) => {
			console.error(`[TelegramDefaultInterface] Telegraf error for update ${ctx_err.updateType}`, err)
		})

	} // end of SimpleTelegramBotSetup

	return {
		Setup: SimpleTelegramBotSetup,
		GetBotConfigTemplate: GetSimpleBotConfigTemplate,
	}
}
