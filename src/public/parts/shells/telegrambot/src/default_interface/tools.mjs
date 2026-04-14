import { Buffer } from 'node:buffer'

import { getPartInfo } from '../../../../../../../src/scripts/locale.mjs'

/**
 * Telegram bot 信息类型
 * @typedef {import('npm:telegraf/typings/core/types/typegram').UserFromGetMe} TelegramBotInfo
 */
/**
 * Telegram 消息类型
 * @typedef {import('npm:telegraf/typings/core/types/typegram').Message} TelegramMessageType
 */
/**
 * Telegram 消息实体类型
 * @typedef {import('npm:telegraf/typings/core/types/typegram').MessageEntity} TelegramMessageEntity
 */
/** @typedef {import('../../../../../../../src/decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase */
/** @typedef {import('../../../chat/decl/chatLog.ts').chatReply_t} ChatReply_t */

/**
 * 简化的 fount 聊天日志条目类型，用于默认接口。
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
 * 从 AI Markdown 正文中提取 Telegram 贴纸 file_id，并移除对应标记（格式见本文件贴纸入库逻辑）。
 * @param {string} markdown - AI 方言 Markdown 正文。
 * @returns {{ cleanMarkdown: string, stickerIds: string[] }} 清理后的正文与提取的贴纸 file_id 列表。
 */
export function extractStickerIdsFromMarkdown(markdown) {
	const stickerIds = []
	const cleanMarkdown = (markdown || '').replace(/<:([^:]+):[^:]*:[^>]*>\s*/g, (_, id) => {
		stickerIds.push(id)
		return ''
	}).trim()
	return { cleanMarkdown, stickerIds }
}

/**
 * 将 Telegram 消息文本和实体转换为 AI 方言 Markdown。
 * @param {string | undefined} text - 原始消息文本。
 * @param {TelegramMessageEntity[] | undefined} entities - Telegram 消息实体数组。
 * @param {TelegramBotInfo | undefined} botInfo - bot自身信息。
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
		}
		else if (replyToMessage.photo)
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
	if (!entities?.length) return aiMarkdown + text
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
 * @param {string} aiMarkdownText - 包含 AI 方言 Markdown 的文本。
 * @returns {string} 转换后的 Telegram HTML 文本。
 */
export function aiMarkdownToTelegramHtml(aiMarkdownText) {
	if (!aiMarkdownText) return ''
	let html = escapeHTML(aiMarkdownText)
	html = html.replace(/```(\w*)\n([\S\s]*?)\n```/g, (match, lang, code) => {
		const langClass = lang ? `class="language-${escapeHTML(lang)}"` : ''
		return /* html */ `<pre><code ${langClass}>${code}</code></pre>`
	})
	html = html.replace(/(?<!\\)`([^\n`]+?)(?<!\\)`/g, (match, code) => /* html */ `<code>${code}</code>`)
	html = html.replace(/\[(.*?)]\((.*?)\)/g, (match, text, url) => /* html */ `<a href="${url}">${text}</a>`)
	html = html.replace(/\|\|(.*?)\|\|/g, (match, content) => /* html */ `<tg-spoiler>${content}</tg-spoiler>`)
	// 单次扫描处理所有行内格式，代码块（<pre>/<code>）原样保留，避免其内容被误解析
	// 斜体要求 * 紧贴非空白字符（符合 CommonMark 规范），防止数学乘号被误判
	html = html.replace(
		/(<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>)|\*\*(.+?)\*\*|(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)|__(.+?)__|~~(.+?)~~/g,
		(match, code, bold, italic, underline, strike) => {
			if (code !== undefined) return code
			if (bold !== undefined) return /* html */ `<b>${bold}</b>`
			if (italic !== undefined) return /* html */ `<i>${italic}</i>`
			if (underline !== undefined) return /* html */ `<u>${underline}</u>`
			return /* html */ `<s>${strike}</s>`
		},
	)
	// 还原转义反引号（\` → `）
	html = html.replace(/\\`/g, '`')
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
		}
		else {
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
 * 将 Telegram 的消息上下文转换为 fount 的聊天日志条目格式。
 * @param {import('npm:telegraf').Context} ctx - Telegraf 的消息上下文.
 * @param {import('npm:telegraf').NarrowedContext<import('npm:telegraf').Context, import('npm:telegraf').Types.Update.MessageUpdate> | { message: TelegramMessageType }} messageHolder - 包含 message 对象的上下文或包装器.
 * @param {TelegramBotInfo} botInfo - bot自身的信息。
 * @param {any} interfaceConfig - 接口配置 (例如 OwnerUserID)。
 * @param {CharAPI_t} charAPI - 当前角色的API对象。
 * @param {string} ownerUsername - fount系统的用户名。
 * @param {string} botCharname - 当前bot绑定的角色名。
 * @param {Record<number, ChatReply_t>} [aiReplyObjectCache] 用于恢复AI回复附加数据的缓存。
 * @returns {Promise<chatLogEntry_t_simple | null>} 转换后的聊天日志条目，或 null。
 */
export async function TelegramMessageToFountChatLogEntry(ctx, messageHolder, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname, aiReplyObjectCache) {
	if (!messageHolder || !messageHolder.message) return null

	const { message } = messageHolder
	const fromUser = message.from
	const { chat } = message

	if (!fromUser) {
		console.warn('[TelegramDefaultInterface] Message without `from` field encountered, skipping:', message)
		return null
	}

	const cachedAIReply = aiReplyObjectCache?.[message.message_id]

	let role = 'char'
	if (fromUser.id === botInfo.id)
		role = 'char'
	else if (interfaceConfig.OwnerUserID && String(fromUser.id) === String(interfaceConfig.OwnerUserID))
		role = 'user'

	let name = ''
	const userDisplayNameCache = interfaceConfig._userDisplayNameCache || {}
	if (fromUser.id in userDisplayNameCache && Math.random() >= 0.1)
		name = userDisplayNameCache[fromUser.id]
	else {
		name = fromUser.first_name || ''
		if (fromUser.last_name) name += ` ${fromUser.last_name}`
		if (!name.trim() && fromUser.username) name = fromUser.username
		if (!name.trim()) name = `User_${fromUser.id}`
		if (!interfaceConfig._userDisplayNameCache) interfaceConfig._userDisplayNameCache = {}
		interfaceConfig._userDisplayNameCache[fromUser.id] = name
	}

	const botDisplayName = (await getPartInfo(charAPI))?.name || botCharname

	const rawText = message.text || message.caption
	const entities = message.entities || message.caption_entities

	// 实体转 AI Markdown，同时嵌入回复引用
	let content = telegramEntitiesToAiMarkdown(rawText, entities, botInfo, message.reply_to_message)
	// 贴纸追加文本描述标记，格式与龙胆一致，可被平台层解析为实物贴纸 file_id
	if (message.sticker) {
		const { sticker } = message
		const stickerDesc = `<:${sticker.file_id}:${sticker.set_name || 'unknown_set'}:${sticker.emoji || ''}>`
		content = [content, stickerDesc].filter(Boolean).join('\n\n')
	}

	const isFromOwner = role === 'user'

	const files = []
	try {
		const telegramApi = ctx.telegram || (ctx.botInfo ? ctx : null)?.telegram
		if (!telegramApi)
			console.warn('[TelegramDefaultInterface] telegram API object not found in context for file processing.')

		if (telegramApi && message.sticker) {
			const { sticker } = message
			let fileIdToDownload = sticker.file_id
			let fileName, mimeType
			const description = `贴纸${sticker.emoji ? `: ${sticker.emoji}` : ''}`

			if (sticker.is_animated)
				if (sticker.thumbnail) {
					fileIdToDownload = sticker.thumbnail.file_id
					fileName = `${sticker.file_unique_id}.jpg`
					mimeType = 'image/jpeg'
				}
				else fileIdToDownload = null
			else if (sticker.is_video) {
				fileName = `${sticker.file_unique_id}.webm`
				mimeType = 'video/webm'
			}
			else {
				fileName = `${sticker.file_unique_id}.webp`
				mimeType = 'image/webp'
			}

			if (fileIdToDownload) try {
				const fileLink = await telegramApi.getFileLink(fileIdToDownload)
				const response = await fetch(fileLink.href)
				const buffer = Buffer.from(await response.arrayBuffer())
				files.push({ name: fileName, buffer, mime_type: mimeType, description })
			} catch (e) {
				console.error(`[TelegramDefaultInterface] 贴纸下载失败 (${sticker.file_unique_id}):`, e)
			}
		}

		if (telegramApi && 'photo' in message && message.photo) {
			const photo = message.photo.reduce((prev, current) => (prev.file_size || 0) > (current.file_size || 0) ? prev : current)
			const fileLink = await telegramApi.getFileLink(photo.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: `${photo.file_unique_id}.jpg`,
				buffer,
				mime_type: 'image/jpeg',
				description: message.caption || '图片'
			})
		}
		else if (telegramApi && 'document' in message && message.document) {
			const doc = message.document
			const fileLink = await telegramApi.getFileLink(doc.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: doc.file_name || `${doc.file_unique_id}`,
				buffer,
				mime_type: doc.mime_type || 'application/octet-stream',
				description: message.caption || '文件'
			})
		}
		else if (telegramApi && 'voice' in message && message.voice) {
			const { voice } = message
			const fileLink = await telegramApi.getFileLink(voice.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: `${voice.file_unique_id}.ogg`,
				buffer,
				mime_type: voice.mime_type || 'audio/ogg',
				description: '语音消息'
			})
		}
		else if (telegramApi && 'audio' in message && message.audio) {
			const { audio } = message
			const fileLink = await telegramApi.getFileLink(audio.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: audio.file_name || `${audio.file_unique_id}.${audio.mime_type?.split('/')[1] || 'mp3'}`,
				buffer,
				mime_type: audio.mime_type || 'audio/mpeg',
				description: audio.title || '音频文件'
			})
		}
		else if (telegramApi && 'video' in message && message.video) {
			const { video } = message
			const fileLink = await telegramApi.getFileLink(video.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: video.file_name || `${video.file_unique_id}.${video.mime_type?.split('/')[1] || 'mp4'}`,
				buffer,
				mime_type: video.mime_type || 'video/mp4',
				description: message.caption || '视频文件'
			})
		}
	}
	catch (error) {
		console.error(`[TelegramDefaultInterface] 文件处理失败 (消息ID ${message.message_id}):`, error)
	}

	if (!content.trim() && !files.length && !cachedAIReply)
		return null

	/** @type {chatLogEntry_t_simple} */
	const entry = {
		...cachedAIReply,
		time_stamp: message.date * 1000,
		role,
		name: role === 'char' && fromUser.id === botInfo.id ? botDisplayName : name,
		content,
		files: cachedAIReply?.files?.length ? cachedAIReply.files : files,
		extension: {
			...cachedAIReply?.extension,
			platform: 'telegram',
			platform_message_ids: [message.message_id],
			platform_channel_id: chat.id,
			platform_user_id: fromUser.id,
			is_from_owner: isFromOwner,
			...message.message_thread_id && { telegram_message_thread_id: message.message_thread_id },
			telegram_message_obj: message,
			...message.reply_to_message && { telegram_reply_to_message_id: message.reply_to_message.message_id }
		}
	}
	return entry
}

/**
 * 智能分割 HTML 字符串，避免截断标签。
 * @param {string} longString - 长 HTML 字符串。
 * @param {number} maxLength - 最大长度。
 * @returns {string[]} 分割后的字符串数组。
 */
function splitHtmlAware(longString, maxLength) {
	const chunks = []
	let remainingString = longString

	while (remainingString.length > maxLength) {
		const candidateChunk = remainingString.substring(0, maxLength)
		const lastTagCloseIndex = candidateChunk.lastIndexOf('>')
		const lastNewlineIndex = candidateChunk.lastIndexOf('\n')
		const lastSpaceIndex = candidateChunk.lastIndexOf(' ')

		let splitPos = Math.max(
			lastTagCloseIndex > -1 ? lastTagCloseIndex + 1 : -1,
			lastNewlineIndex > -1 ? lastNewlineIndex + 1 : -1,
			lastSpaceIndex > -1 ? lastSpaceIndex + 1 : -1
		)

		if (splitPos <= 1)
			splitPos = maxLength

		chunks.push(remainingString.substring(0, splitPos))
		remainingString = remainingString.substring(splitPos)
	}

	if (remainingString.length)
		chunks.push(remainingString)

	return chunks
}

/**
 * 分割 Telegram 回复文本以适应其消息长度限制。超长行按 HTML 边界智能分割。
 * @param {string} reply - 原始回复文本（HTML 格式）。
 * @param {number} [split_length=4096] - 每条消息的最大长度。
 * @returns {string[]} 分割后的消息片段数组。
 */
export function splitTelegramReply(reply, split_length = 4096) {
	if (!reply) return []

	const messages = []
	let currentMessage = ''
	const lines = reply.split('\n')

	for (const line of lines) {
		const lineLength = line.length
		const separatorLength = currentMessage ? 1 : 0

		if (currentMessage.length + separatorLength + lineLength <= split_length) {
			if (currentMessage)
				currentMessage += '\n'
			currentMessage += line
		}
		else if (lineLength > split_length) {
			if (currentMessage) {
				messages.push(currentMessage)
				currentMessage = ''
			}
			const parts = splitHtmlAware(line, split_length)
			if (parts.length > 1) {
				messages.push(...parts.slice(0, -1))
				currentMessage = parts[parts.length - 1]
			}
			else if (parts.length === 1)
				currentMessage = parts[0]
		}
		else {
			if (currentMessage) messages.push(currentMessage)
			currentMessage = line
		}
	}

	if (currentMessage)
		if (currentMessage.length > split_length)
			messages.push(...splitHtmlAware(currentMessage, split_length))
		else
			messages.push(currentMessage)


	return messages.filter(msg => msg.trim().length)
}
