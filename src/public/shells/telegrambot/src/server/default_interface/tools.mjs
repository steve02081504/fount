import { Buffer } from 'node:buffer'
import { getPartInfo } from '../../../../../../scripts/locale.mjs' // 确保路径正确

/**
 * @typedef {import('npm:telegraf/typings/core/types/typegram').UserFromGetMe} TelegramBotInfo
 */
/**
 * @typedef {import('npm:telegraf/typings/core/types/typegram').Message} TelegramMessageType
 */
/**
 * @typedef {import('npm:telegraf/typings/core/types/typegram').MessageEntity} TelegramMessageEntity
 */
/** @typedef {import('../../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */

/**
 * 简化的 Fount 聊天日志条目类型，用于默认接口。
 * 扩展信息与自定义接口的 fountEntry.extension 结构尽量保持一致。
 * @typedef { (FountChatLogEntryBase & {
 *  extension?: {
 *      platform: 'telegram',
 *      platform_message_ids?: (number | string)[], // 消息ID数组
 *      platform_channel_id?: number | string,      // Telegram chat.id
 *      platform_user_id?: number | string,         // Telegram from.id
 *      telegram_message_thread_id?: number,   // 分区ID
 *      is_from_owner?: boolean,
 *      telegram_message_obj?: TelegramMessageType, // 原始TG消息对象
 *      [key: string]: any
 *  }
 * })} chatLogEntry_t_simple
 */

/**
 * 将 HTML 特殊字符转义，用于构建安全的 HTML 内容。
 * @param {string} text - 需要转义的文本。
 * @returns {string} 转义后的文本。
 */
export function escapeHTML(text) {
	if (typeof text !== 'string') return ''
	return text.replace(/["&'<>]/g, function (match) {
		switch (match) {
			case '&': return '&amp;'
			case '<': return '&lt;'
			case '>': return '&gt;'
			case '"': return '&#34;'
			case '\'': return '&#39;'
			default: return match
		}
	})
}

/**
 * 将 Telegram 消息文本和实体转换为 AI 方言 Markdown。
 * (此函数保持不变)
 * @param {string | undefined} text - 原始消息文本。
 * @param {TelegramMessageEntity[] | undefined} entities - Telegram 消息实体数组。
 * @param {TelegramBotInfo | undefined} botInfo - 机器人自身信息。
 * @param {TelegramMessageType | undefined} replyToMessage - 被回复的 Telegram 消息对象。
 * @returns {string} 转换后的 AI 方言 Markdown 文本。
 */
export function telegramEntitiesToAiMarkdown(text, entities, botInfo, replyToMessage) {
	let aiMarkdown = ''
	if (replyToMessage) {
		const repliedFrom = replyToMessage.from
		let replierName = '未知用户'
		if (repliedFrom)
			if (botInfo && repliedFrom.id === botInfo.id)
				replierName = botInfo.first_name || botInfo.username || '我'
			else
				replierName = repliedFrom.first_name || repliedFrom.username || `User_${repliedFrom.id}`


		const repliedTextContent = replyToMessage.text || replyToMessage.caption || ''
		const repliedEntities = replyToMessage.entities || replyToMessage.caption_entities
		let repliedPreview = ''
		if (repliedTextContent) {
			const maxLength = 80
			const isTruncated = repliedTextContent.length > maxLength
			const previewText = repliedTextContent.substring(0, maxLength) + (isTruncated ? '...' : '')
			repliedPreview = telegramEntitiesToAiMarkdown(previewText, repliedEntities, undefined, undefined)
		} else if (replyToMessage.photo)
			repliedPreview = '[图片]'
		else if (replyToMessage.video)
			repliedPreview = '[视频]'
		else if (replyToMessage.voice)
			repliedPreview = '[语音]'
		else if (replyToMessage.document)
			repliedPreview = `[文件: ${replyToMessage.document.file_name || '未知'}]`

		if (repliedPreview) {
			aiMarkdown += repliedPreview.split('\n').map(line => `> ${line}`).join('\n')
			aiMarkdown += `\n(回复 ${replierName})\n\n`
		}
	}
	if (!text) return aiMarkdown.trim()
	const textChars = Array.from(text)
	if (!entities || entities.length === 0) return aiMarkdown + text
	const parts = []
	let lastOffset = 0
	const sortedEntities = [...entities].sort((a, b) => a.offset - b.offset)
	for (const entity of sortedEntities) {
		if (entity.offset > lastOffset)
			parts.push(textChars.slice(lastOffset, entity.offset).join(''))

		const entityText = textChars.slice(entity.offset, entity.offset + entity.length).join('')
		let formattedEntityText = entityText
		switch (entity.type) {
			case 'bold': formattedEntityText = `**${entityText}**`; break
			case 'italic': formattedEntityText = `*${entityText}*`; break
			case 'underline': formattedEntityText = `__${entityText}__`; break
			case 'strikethrough': formattedEntityText = `~~${entityText}~~`; break
			case 'spoiler': formattedEntityText = `||${entityText}||`; break
			case 'code': formattedEntityText = `\`${entityText}\``; break
			case 'pre': formattedEntityText = '```' + (entity.language ? entity.language : '') + '\n' + entityText + '\n```'; break
			case 'text_link': formattedEntityText = `[${entityText}](${entity.url})`; break
			case 'blockquote': formattedEntityText = entityText.split('\n').map(line => `> ${line}`).join('\n'); break
			case 'text_mention': formattedEntityText = `@[${entityText} (UserID:${entity.user.id})]`; break
			case 'mention': case 'hashtag': case 'cashtag': case 'bot_command': case 'url': case 'email': case 'phone_number':
				formattedEntityText = entityText; break
			default: formattedEntityText = entityText
		}
		parts.push(formattedEntityText)
		lastOffset = entity.offset + entity.length
	}
	if (lastOffset < textChars.length)
		parts.push(textChars.slice(lastOffset).join(''))

	aiMarkdown += parts.join('')
	return aiMarkdown.trim()
}

/**
 * 将 AI 方言 Markdown 转换为 Telegram HTML 格式。
 * (此函数保持不变)
 * @param {string} aiMarkdownText - 包含 AI 方言 Markdown 的文本。
 * @returns {string} 转换后的 Telegram HTML 文本。
 */
export function aiMarkdownToTelegramHtml(aiMarkdownText) {
	if (!aiMarkdownText) return ''
	let html = escapeHTML(aiMarkdownText)
	html = html.replace(/```(\w*)\n([\S\s]*?)\n```/g, (match, lang, code) => {
		const langClass = lang ? ` class="language-${escapeHTML(lang)}"` : ''
		return `<pre><code${langClass}>${code}</code></pre>`
	})
	html = html.replace(/(?<!\\)`([^\n`]+?)(?<!\\)`/g, (match, code) => `<code>${code}</code>`)
	html = html.replace(/\[(.*?)]\((.*?)\)/g, (match, text, url) => `<a href="${url}">${text}</a>`)
	html = html.replace(/\|\|(.*?)\|\|/g, (match, content) => `<tg-spoiler>${content}</tg-spoiler>`)
	html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
	html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<i>$1</i>')
	html = html.replace(/__(.+?)__/g, '<u>$1</u>')
	html = html.replace(/~~(.+?)~~/g, '<s>$1</s>')
	const lines = html.split('\n')
	let inBlockquote = false
	const processedLines = []
	const blockquoteStartTag = '&gt; '
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.startsWith(blockquoteStartTag)) {
			const quoteContent = line.substring(blockquoteStartTag.length)
			if (!inBlockquote) {
				processedLines.push('<blockquote>')
				inBlockquote = true
			}
			processedLines.push(quoteContent)
		} else {
			if (inBlockquote) {
				processedLines.push('</blockquote>')
				inBlockquote = false
			}
			processedLines.push(line)
		}
	}
	if (inBlockquote)
		processedLines.push('</blockquote>')

	html = processedLines.join('\n')
	return html
}

/**
 * 将 Telegram 的消息上下文转换为 Fount 的聊天日志条目格式。
 * @param {import('npm:telegraf').Context} ctx - Telegraf 的消息上下文.
 * @param {import('npm:telegraf').NarrowedContext<import('npm:telegraf').Context, import('npm:telegraf').Types.Update.MessageUpdate> | { message: TelegramMessageType }} messageHolder - 包含 message 对象的上下文或包装器.
 * @param {TelegramBotInfo} botInfo - 机器人自身的信息。
 * @param {any} interfaceConfig - 接口配置 (例如 OwnerUserID)。
 * @param {charAPI_t} charAPI - 当前角色的API对象。
 * @param {string} ownerUsername - Fount系统的用户名。
 * @param {string} botCharname - 当前机器人绑定的角色名。
 * @returns {Promise<chatLogEntry_t_simple | null>} 转换后的聊天日志条目，或 null。
 */
export async function TelegramMessageToFountChatLogEntry(ctx, messageHolder, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname) {
	if (!messageHolder || !messageHolder.message) return null

	const { message } = messageHolder
	const fromUser = message.from
	const { chat } = message

	if (!fromUser) {
		console.warn('[TelegramDefaultInterface] Message without `from` field encountered, skipping:', message)
		return null
	}

	let role = 'char'
	if (fromUser.id === botInfo.id)
		role = 'char'
	else if (interfaceConfig.OwnerUserID && String(fromUser.id) === String(interfaceConfig.OwnerUserID))
		role = 'user'


	let name = fromUser.first_name || ''
	if (fromUser.last_name) name += ` ${fromUser.last_name}`
	if (!name.trim() && fromUser.username) name = fromUser.username
	if (!name.trim()) name = `User_${fromUser.id}`

	// 确保 getPartInfo 使用正确的 locales 参数，如果需要的话。这里假设它能处理默认情况。
	const botDisplayName = (await getPartInfo(charAPI))?.name || botCharname

	const rawText = message.text || message.caption
	const entities = message.entities || message.caption_entities
	const content = telegramEntitiesToAiMarkdown(rawText, entities, botInfo, message.reply_to_message)

	const files = []
	// ... (文件处理逻辑保持不变，确保 try-catch 和 telegramApi 的获取是健壮的) ...
	try {
		const telegramApi = ctx.telegram || (ctx.botInfo ? ctx : null)?.telegram
		if (!telegramApi)
			console.warn('[TelegramDefaultInterface] telegram API object not found in context for file processing.')


		if (telegramApi && 'photo' in message && message.photo) {
			const photo = message.photo.reduce((prev, current) => (prev.file_size || 0) > (current.file_size || 0) ? prev : current)
			const fileLink = await telegramApi.getFileLink(photo.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: `${photo.file_unique_id}.jpg`,
				buffer,
				mimeType: 'image/jpeg',
				description: message.caption || '图片'
			})
		} else if (telegramApi && 'document' in message && message.document) {
			const doc = message.document
			const fileLink = await telegramApi.getFileLink(doc.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: doc.file_name || `${doc.file_unique_id}`,
				buffer,
				mimeType: doc.mime_type || 'application/octet-stream',
				description: message.caption || '文件'
			})
		} else if (telegramApi && 'voice' in message && message.voice) {
			const { voice } = message
			const fileLink = await telegramApi.getFileLink(voice.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: `${voice.file_unique_id}.ogg`,
				buffer,
				mimeType: voice.mime_type || 'audio/ogg',
				description: '语音消息'
			})
		} else if (telegramApi && 'audio' in message && message.audio) {
			const { audio } = message
			const fileLink = await telegramApi.getFileLink(audio.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: audio.file_name || `${audio.file_unique_id}.${audio.mime_type?.split('/')[1] || 'mp3'}`,
				buffer,
				mimeType: audio.mime_type || 'audio/mpeg',
				description: audio.title || '音频文件'
			})
		} else if (telegramApi && 'video' in message && message.video) {
			const { video } = message
			const fileLink = await telegramApi.getFileLink(video.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: video.file_name || `${video.file_unique_id}.${video.mime_type?.split('/')[1] || 'mp4'}`,
				buffer,
				mimeType: video.mime_type || 'video/mp4',
				description: message.caption || '视频文件'
			})
		}
	} catch (error) {
		console.error(`[TelegramDefaultInterface] 文件处理失败 (消息ID ${message.message_id}):`, error)
	}

	if (!content.trim() && files.length === 0)
		return null


	/** @type {chatLogEntry_t_simple} */
	const entry = {
		timeStamp: message.date * 1000,
		role,
		name: role === 'char' && fromUser.id === botInfo.id ? botDisplayName : name,
		content,
		files,
		extension: {
			platform: 'telegram',
			platform_message_ids: [message.message_id], // 确保是数组
			platform_channel_id: chat.id,             // 原始群组/私聊 ID
			platform_user_id: fromUser.id,            // 原始用户 ID
			// 新增：存储 message_thread_id (如果存在)
			...message.message_thread_id && { telegram_message_thread_id: message.message_thread_id },
			is_from_owner: role === 'user',
			telegram_message_obj: message,
			...message.reply_to_message && { telegram_reply_to_message_id: message.reply_to_message.message_id }
		}
	}
	return entry
}

/**
 * 分割 Telegram 回复文本以适应其消息长度限制。
 * (此函数保持不变)
 * @param {string} reply - 原始回复文本。
 * @param {number} [split_length=4096] - 每条消息的最大长度。
 * @returns {string[]} 分割后的消息片段数组。
 */
export function splitTelegramReply(reply, split_length = 4096) {
	if (!reply) return []
	const messages = []
	let currentMessage = ''
	const lines = reply.split('\n')
	for (const line of lines)
		if (currentMessage.length + (currentMessage ? 1 : 0) + line.length <= split_length) {
			if (currentMessage)
				currentMessage += '\n'

			currentMessage += line
		} else
			if (line.length > split_length) {
				if (currentMessage) {
					messages.push(currentMessage)
					currentMessage = ''
				}
				for (let i = 0; i < line.length; i += split_length)
					messages.push(line.substring(i, Math.min(i + split_length, line.length)))

			} else {
				if (currentMessage)
					messages.push(currentMessage)

				currentMessage = line
			}


	if (currentMessage)
		messages.push(currentMessage)

	return messages.filter(msg => msg.trim().length > 0)
}
