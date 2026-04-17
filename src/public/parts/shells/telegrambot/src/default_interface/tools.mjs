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
 *      content_parts?: string[],
 *      telegram_media_group_id?: string,
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
 * @typedef {{ name: string, buffer: Buffer, mime_type: string, description: string }} TelegramResolvedFile_t
 */
/**
 * 惰性附件槽：与龙胆 `processMessageFiles` 一致，仅在调用方需要时再 `fetch`（默认在即将 `GetReply` 时由 {@link resolveTelegramChatLogEntryFilesInPlace} 统一拉取）。
 * @typedef {() => Promise<TelegramResolvedFile_t | undefined>} TelegramLazyFileLoader_t
 */

/**
 * 从上下文中取出 Telegram Bot API 客户端。
 * @param {import('npm:telegraf').Context} ctx - Telegraf 上下文。
 * @returns {import('npm:telegraf').Telegram | undefined} `ctx.telegram` 或等价 accessor。
 */
function getTelegramApiFromCtx(ctx) {
	return ctx.telegram || (ctx.botInfo ? ctx : null)?.telegram
}

/**
 * 为单条消息构造惰性下载任务数组（每个元素为返回单文件或 `undefined` 的异步函数）。
 * @param {import('npm:telegraf').Context} ctx - Telegraf 上下文。
 * @param {TelegramMessageType} message - Telegram 消息对象。
 * @returns {TelegramLazyFileLoader_t[]} 每个元素为「执行时下载单附件」的异步函数。
 */
export function createLazyTelegramMessageFileLoaders(ctx, message) {
	/** @type {TelegramLazyFileLoader_t[]} */
	const loaders = []
	const telegramApi = getTelegramApiFromCtx(ctx)
	if (!telegramApi) {
		console.warn('[TelegramDefaultInterface] telegram API object not found in context for file processing.')
		return loaders
	}

	if (message.sticker) {
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

		if (fileIdToDownload)
			loaders.push(async () => {
				try {
					const fileLink = await telegramApi.getFileLink(fileIdToDownload)
					const response = await fetch(fileLink.href)
					const buffer = Buffer.from(await response.arrayBuffer())
					return { name: fileName, buffer, mime_type: mimeType, description }
				} catch (e) {
					console.error(`[TelegramDefaultInterface] 贴纸下载失败 (${sticker.file_unique_id}):`, e)
				}
			})
	}
	else if (message.photo) {
		const photo = message.photo.reduce((prev, current) => (prev.file_size || 0) > (current.file_size || 0) ? prev : current)
		const fileId = photo.file_id
		loaders.push(async () => {
			try {
				const fileLink = await telegramApi.getFileLink(fileId)
				const response = await fetch(fileLink.href)
				const buffer = Buffer.from(await response.arrayBuffer())
				return {
					name: `${photo.file_unique_id}.jpg`,
					buffer,
					mime_type: 'image/jpeg',
					description: message.caption || '图片'
				}
			} catch (e) {
				console.error(`[TelegramDefaultInterface] 图片下载失败 (消息ID ${message.message_id}):`, e)
			}
		})
	}
	else if (message.document) {
		const doc = message.document
		const fileId = doc.file_id
		loaders.push(async () => {
			try {
				const fileLink = await telegramApi.getFileLink(fileId)
				const response = await fetch(fileLink.href)
				const buffer = Buffer.from(await response.arrayBuffer())
				return {
					name: doc.file_name || `${doc.file_unique_id}`,
					buffer,
					mime_type: doc.mime_type || 'application/octet-stream',
					description: message.caption || '文件'
				}
			} catch (e) {
				console.error(`[TelegramDefaultInterface] 文档下载失败 (消息ID ${message.message_id}):`, e)
			}
		})
	}
	else if (message.voice) {
		const { voice } = message
		const fileId = voice.file_id
		loaders.push(async () => {
			try {
				const fileLink = await telegramApi.getFileLink(fileId)
				const response = await fetch(fileLink.href)
				const buffer = Buffer.from(await response.arrayBuffer())
				return {
					name: `${voice.file_unique_id}.ogg`,
					buffer,
					mime_type: voice.mime_type || 'audio/ogg',
					description: '语音消息'
				}
			} catch (e) {
				console.error(`[TelegramDefaultInterface] 语音下载失败 (消息ID ${message.message_id}):`, e)
			}
		})
	}
	else if (message.audio) {
		const { audio } = message
		const fileId = audio.file_id
		loaders.push(async () => {
			try {
				const fileLink = await telegramApi.getFileLink(fileId)
				const response = await fetch(fileLink.href)
				const buffer = Buffer.from(await response.arrayBuffer())
				return {
					name: audio.file_name || `${audio.file_unique_id}.${audio.mime_type?.split('/')[1] || 'mp3'}`,
					buffer,
					mime_type: audio.mime_type || 'audio/mpeg',
					description: audio.title || '音频文件'
				}
			} catch (e) {
				console.error(`[TelegramDefaultInterface] 音频下载失败 (消息ID ${message.message_id}):`, e)
			}
		})
	}
	else if (message.video) {
		const { video } = message
		const fileId = video.file_id
		loaders.push(async () => {
			try {
				const fileLink = await telegramApi.getFileLink(fileId)
				const response = await fetch(fileLink.href)
				const buffer = Buffer.from(await response.arrayBuffer())
				return {
					name: video.file_name || `${video.file_unique_id}.${video.mime_type?.split('/')[1] || 'mp4'}`,
					buffer,
					mime_type: video.mime_type || 'video/mp4',
					description: message.caption || '视频文件'
				}
			} catch (e) {
				console.error(`[TelegramDefaultInterface] 视频下载失败 (消息ID ${message.message_id}):`, e)
			}
		})
	}

	return loaders
}

/**
 * 判断 `files` 是否为惰性槽数组（首项为函数）。
 * @param {unknown} files - 待检测的 `files` 字段。
 * @returns {boolean} 为惰性槽布局时返回 true。
 */
export function isLazyTelegramFileSlots(files) {
	return Array.isArray(files) && files.length > 0 && typeof files[0] === 'function'
}

/**
 * 若该条目的 `files` 为惰性槽，则并发拉取并写回为已解析文件数组（与龙胆在入队前 `fetchFiles` 类似，此处绑定在即将调用 `GetReply` 时）。
 * @param {chatLogEntry_t_simple} entry - 单条聊天日志（就地改写 `files`）。
 * @returns {Promise<void>} 无返回值；失败的分片在对应 loader 内记日志并省略。
 */
export async function resolveTelegramChatLogEntryFilesInPlace(entry) {
	if (!entry?.files?.length) return
	if (!isLazyTelegramFileSlots(entry.files)) return
	entry.files = (await Promise.all(entry.files.map(fn => fn()))).filter(Boolean)
}

/**
 * 与龙胆 `bot_core/processMessageUpdate` 逐行一致（无返回值；龙胆侧为 `async` 但体内无 `await`，此处用同步函数避免无意义 `async`）。
 * @param {chatLogEntry_t_simple[]} log - 对应龙胆 `channelChatLogs[channelId]`。
 * @param {chatLogEntry_t_simple} updatedFountEntry - 对应龙胆接入层传入条目。
 * @returns {void}
 */
export function applyTelegramMessageUpdateToChannelLog(log, updatedFountEntry) {
	if (!log || !updatedFountEntry.extension?.platform_message_ids?.length) return

	const updatedMsgId = updatedFountEntry.extension.platform_message_ids[0]

	const entryIndex = log.findIndex(entry =>
		entry.extension?.platform_message_ids?.includes(updatedMsgId)
	)

	if (entryIndex > -1) {
		const entryToUpdate = log[entryIndex]
		const partIndex = entryToUpdate.extension.platform_message_ids.indexOf(updatedMsgId)

		if (partIndex > -1) {
			const newContentPart = ((updatedFountEntry.extension.content_parts?.[0] || updatedFountEntry.content)).replace(/（已编辑）$/, '') + '（已编辑）'
			entryToUpdate.extension.content_parts[partIndex] = newContentPart

			entryToUpdate.time_stamp = updatedFountEntry.time_stamp
			if (updatedFountEntry.files?.length)
				entryToUpdate.files = [...entryToUpdate.files || [], ...updatedFountEntry.files]

			entryToUpdate.content = entryToUpdate.extension.content_parts.join('\n')
		}
	}
}

/**
 * 拼出单条 TG 消息对应的 AI Markdown 正文片段（含可选回复引用与贴纸标记）。
 * @param {TelegramMessageType} message - 当前分片消息。
 * @param {TelegramBotInfo} botInfo - Bot 信息，用于实体解析中的「我」等。
 * @param {TelegramMessageType | undefined} replyToMessageForAiPrompt - 作为引用块展示的被回复消息；undefined 时不加引用。
 * @returns {string} 正文片段。
 */
function buildTelegramMessageTextContentPart(message, botInfo, replyToMessageForAiPrompt) {
	const rawText = message.text || message.caption
	const entities = message.entities || message.caption_entities
	let content = telegramEntitiesToAiMarkdown(rawText, entities, botInfo, replyToMessageForAiPrompt)
	if (message.sticker) {
		const { sticker } = message
		const stickerDesc = `<:${sticker.file_id}:${sticker.set_name || 'unknown_set'}:${sticker.emoji || ''}>`
		content = [content, stickerDesc].filter(Boolean).join('\n\n')
	}
	return content
}

/**
 * 与龙胆 `detectMentions` 一致：在论坛主题中，若回复的是「主题创建」那条系统消息，则不在正文里注入引用块（避免把主题元信息当普通回复引用）。
 * @param {TelegramMessageType} message - 当前分片消息。
 * @param {any} interfaceConfig - 接口配置（需含 `OwnerUserID`）。
 * @param {string} chatType - `message.chat.type`。
 * @returns {boolean} 属于「回复主题创建消息」时为 true。
 */
function isReplyToOwnerTopicCreationMessage(message, interfaceConfig, chatType) {
	if (chatType === 'private') return false
	if (!interfaceConfig?.OwnerUserID) return false
	if (message.reply_to_message?.from?.id !== Number(interfaceConfig.OwnerUserID)) return false
	return message.reply_to_message.message_id === message.message_thread_id
}

/**
 * 相册内各分片正文与合并全文（仅首条带回复引用，且排除主题创建回复）。
 * @param {TelegramMessageType[]} sorted - 已按 `message_id` 排序的媒体组消息。
 * @param {TelegramBotInfo} botInfo - Bot 信息。
 * @param {any} interfaceConfig - 接口配置。
 * @returns {{ contentParts: string[], content: string }} 分片数组与 `\n` 拼接全文。
 */
function extractMediaGroupContentParts(sorted, botInfo, interfaceConfig) {
	const contentParts = []
	let replyQuotedInjected = false
	const { chat } = sorted[0]
	for (const message of sorted) {
		let replyToMessageForAiPrompt
		if (message.reply_to_message && !replyQuotedInjected)
			if (!isReplyToOwnerTopicCreationMessage(message, interfaceConfig, chat.type)) {
				replyToMessageForAiPrompt = message.reply_to_message
				replyQuotedInjected = true
			}

		contentParts.push(buildTelegramMessageTextContentPart(message, botInfo, replyToMessageForAiPrompt))
	}
	return { contentParts, content: contentParts.join('\n') }
}

/**
 * 合并相册内各 `message_id` 命中的 `aiReplyObjectCache` 并删除已消费键。
 * @param {TelegramMessageType[]} sorted - 已排序的媒体组消息。
 * @param {Record<number, ChatReply_t>} [aiReplyObjectCache] - Bot 发出消息 ID → 原始 AI 回复。
 * @returns {{ mergedAiReply: Record<string, unknown>, mergedAiReplyExtension: Record<string, unknown> }} 供展开到条目根与 `extension`。
 */
function mergeAiReplyCacheForMessages(sorted, aiReplyObjectCache) {
	let mergedAiReply = {}
	let mergedAiReplyExtension = {}
	if (!aiReplyObjectCache) return { mergedAiReply, mergedAiReplyExtension }
	for (const message of sorted) {
		const mid = message.message_id
		const cached = aiReplyObjectCache[mid]
		if (!cached) continue
		mergedAiReply = { ...mergedAiReply, ...cached }
		if (cached.extension)
			mergedAiReplyExtension = { ...mergedAiReplyExtension, ...cached.extension }
		delete aiReplyObjectCache[mid]
	}
	return { mergedAiReply, mergedAiReplyExtension }
}

/**
 * 将同一相册（`media_group_id` 相同）的多条 Telegram 消息合并为一条 `chatLogEntry_t_simple`。
 * @param {import('npm:telegraf').Context} ctx - Telegraf 上下文。
 * @param {TelegramMessageType[]} messages - 同一媒体组的消息（调用方已按接收去重）。
 * @param {TelegramBotInfo} botInfo - bot 信息。
 * @param {any} interfaceConfig - 接口配置。
 * @param {CharAPI_t} charAPI - 角色 API。
 * @param {string} botCharname - 当前 bot 绑定角色名。
 * @param {Record<number, ChatReply_t>} [aiReplyObjectCache] - AI 回复缓存。
 * @param {Record<number, string>} [userDisplayNameCache={}] - 用户显示名缓存（由上层闭包注入）。
 * @returns {Promise<chatLogEntry_t_simple | null>} 合并成功返回一条日志；无有效正文与附件且无缓存正文时返回 null。
 */
export async function telegramMediaGroupMessagesToFountChatLogEntry(ctx, messages, botInfo, interfaceConfig, charAPI, botCharname, aiReplyObjectCache, userDisplayNameCache = {}) {
	if (!messages?.length) return null

	const sorted = [...messages].sort((a, b) => a.message_id - b.message_id)
	const primary = sorted[0]
	if (!primary.from) return null

	for (const m of sorted)
		if (m.from?.id !== primary.from.id || m.chat.id !== primary.chat.id)
			console.warn('[TelegramDefaultInterface] Media group member chat/from mismatch, still merging.', {
				media_group_id: primary.media_group_id,
				expected_from: primary.from.id,
				got_from: m.from?.id,
			})

	const fromUser = primary.from
	const { chat } = primary

	let role = 'char'
	if (fromUser.id === botInfo.id)
		role = 'char'
	else if (interfaceConfig.OwnerUserID && String(fromUser.id) === String(interfaceConfig.OwnerUserID))
		role = 'user'

	let name = ''
	if (fromUser.id in userDisplayNameCache && Math.random() >= 0.1)
		name = userDisplayNameCache[fromUser.id]
	else {
		name = fromUser.first_name || ''
		if (fromUser.last_name) name += ` ${fromUser.last_name}`
		if (!name.trim() && fromUser.username) name = fromUser.username
		if (!name.trim()) name = `User_${fromUser.id}`
		userDisplayNameCache[fromUser.id] = name
	}

	const botDisplayName = (await getPartInfo(charAPI))?.name || botCharname
	const { contentParts, content } = extractMediaGroupContentParts(sorted, botInfo, interfaceConfig)
	const files = sorted.flatMap(m => createLazyTelegramMessageFileLoaders(ctx, m))
	const { mergedAiReply, mergedAiReplyExtension } = mergeAiReplyCacheForMessages(sorted, aiReplyObjectCache)

	const isFromOwner = role === 'user'
	const messageWithReply = sorted.find(m => m.reply_to_message)

	const hasMergedAiBody = !!(mergedAiReply.content || mergedAiReply.content_for_show || mergedAiReply.files?.length)
	if (!content.trim() && !files.length && !hasMergedAiBody)
		return null

	const time_stamp = Math.max(...sorted.map(m => (m.edit_date ?? m.date) * 1000))

	/** @type {chatLogEntry_t_simple} */
	const entry = {
		...mergedAiReply,
		time_stamp,
		role,
		name: role === 'char' && fromUser.id === botInfo.id ? botDisplayName : name,
		content,
		files: mergedAiReply?.files?.length ? mergedAiReply.files : files,
		extension: {
			...mergedAiReplyExtension,
			platform: 'telegram',
			platform_message_ids: sorted.map(m => m.message_id),
			content_parts: contentParts,
			platform_channel_id: chat.id,
			platform_user_id: fromUser.id,
			is_from_owner: isFromOwner,
			...primary.message_thread_id !== undefined && { telegram_message_thread_id: primary.message_thread_id },
			telegram_message_obj: primary,
			telegram_media_group_id: primary.media_group_id,
			...messageWithReply?.reply_to_message && { telegram_reply_to_message_id: messageWithReply.reply_to_message.message_id }
		}
	}
	return entry
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
 * @param {Record<number, string>} [userDisplayNameCache={}] - 用户显示名缓存（由上层闭包注入）。
 * @returns {Promise<chatLogEntry_t_simple | null>} 转换后的聊天日志条目，或 null。
 */
export async function TelegramMessageToFountChatLogEntry(ctx, messageHolder, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname, aiReplyObjectCache, userDisplayNameCache = {}) {
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
	if (fromUser.id in userDisplayNameCache && Math.random() >= 0.1)
		name = userDisplayNameCache[fromUser.id]
	else {
		name = fromUser.first_name || ''
		if (fromUser.last_name) name += ` ${fromUser.last_name}`
		if (!name.trim() && fromUser.username) name = fromUser.username
		if (!name.trim()) name = `User_${fromUser.id}`
		userDisplayNameCache[fromUser.id] = name
	}

	const botDisplayName = (await getPartInfo(charAPI))?.name || botCharname

	const rawText = message.text || message.caption
	const entities = message.entities || message.caption_entities

	let replyToMessageForAiPrompt = message.reply_to_message
	if (isReplyToOwnerTopicCreationMessage(message, interfaceConfig, chat.type))
		replyToMessageForAiPrompt = undefined

	// 实体转 AI Markdown，同时嵌入回复引用（论坛主题创建回复不加引用块，与龙胆一致）
	let content = telegramEntitiesToAiMarkdown(rawText, entities, botInfo, replyToMessageForAiPrompt)
	// 贴纸追加文本描述标记，格式与龙胆一致，可被平台层解析为实物贴纸 file_id
	if (message.sticker) {
		const { sticker } = message
		const stickerDesc = `<:${sticker.file_id}:${sticker.set_name || 'unknown_set'}:${sticker.emoji || ''}>`
		content = [content, stickerDesc].filter(Boolean).join('\n\n')
	}

	const isFromOwner = role === 'user'

	const files = createLazyTelegramMessageFileLoaders(ctx, message)

	if (!content.trim() && !files.length && !cachedAIReply)
		return null

	/** @type {chatLogEntry_t_simple} */
	const entry = {
		...cachedAIReply,
		time_stamp: message.edit_date ? message.edit_date * 1000 : message.date * 1000,
		role,
		name: role === 'char' && fromUser.id === botInfo.id ? botDisplayName : name,
		content,
		files: cachedAIReply?.files?.length ? cachedAIReply.files : files,
		extension: {
			...cachedAIReply?.extension,
			platform: 'telegram',
			platform_message_ids: [message.message_id],
			content_parts: [content],
			platform_channel_id: chat.id,
			platform_user_id: fromUser.id,
			is_from_owner: isFromOwner,
			...message.message_thread_id !== undefined && { telegram_message_thread_id: message.message_thread_id },
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
