import { Buffer } from 'node:buffer'

import { formatEntityMentionToken } from '../../chat/public/shared/inlineTokenSyntax.mjs'

const FOUNT_ENTITY_MENTION_RE = /@\[entity:([0-9a-f]{128})\]/gi

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
 * UTF-16 码元长度（Telegram entity offset 用；JS string.length 即 UTF-16）。
 * @param {string} text 文本
 * @returns {number} UTF-16 码元数
 */
function utf16Length(text) {
	return text.length
}

/**
 * @param {string} text 文本
 * @param {number} offset UTF-16 码元偏移
 * @param {number} length UTF-16 码元长度
 * @returns {string} 切片
 */
function utf16Slice(text, offset, length) {
	return text.slice(offset, offset + length)
}

/**
 * @param {string} text 文本
 * @param {number} offset UTF-16 码元偏移
 * @param {number} length UTF-16 码元长度
 * @param {string} replacement 替换内容
 * @returns {string} 替换后文本
 */
function utf16Replace(text, offset, length, replacement) {
	return text.slice(0, offset) + replacement + text.slice(offset + length)
}

/**
 * 对同一段文本叠加 Telegram 实体（结构类优先，样式外包）。
 * @param {string} inner - 已处理好的内层文本。
 * @param {TelegramMessageEntity[]} spanEntities - 覆盖同一 UTF-16 区间的实体。
 * @returns {{ text: string, stylePrefix: number, innerPrefix: number, mentionLength: number, mentionEntity: TelegramMessageEntity | undefined }}
 */
function applyTelegramSpanFormats(inner, spanEntities) {
	let text = inner
	/** @type {TelegramMessageEntity | undefined} */
	let mentionEntity
	let contentPrefix = 0
	for (const entity of spanEntities)
		switch (entity.type) {
			case 'text_mention':
				text = `@[${text} (UserID:${entity.user.id})]`
				mentionEntity = entity
				contentPrefix = 2
				break
			case 'text_link':
				text = `[${text}](${entity.url})`
				contentPrefix = 1
				break
			case 'code':
				text = `\`${text}\``
				contentPrefix = 1
				break
			case 'pre':
				text = '```' + (entity.language ? entity.language : '') + '\n' + text + '\n```'
				contentPrefix = 3 + (entity.language ? entity.language.length : 0) + 1
				break
			case 'blockquote':
				text = text.split('\n').map(line => `> ${line}`).join('\n')
				contentPrefix = 2
				break
			default: break
		}

	const mentionLength = mentionEntity ? utf16Length(text) : 0
	let stylePrefix = 0
	for (const entity of spanEntities)
		switch (entity.type) {
			case 'bold': text = `**${text}**`; stylePrefix += 2; break
			case 'italic': text = `*${text}*`; stylePrefix += 1; break
			case 'underline': text = `__${text}__`; stylePrefix += 2; break
			case 'strikethrough': text = `~~${text}~~`; stylePrefix += 2; break
			case 'spoiler': text = `||${text}||`; stylePrefix += 2; break
			default: break
		}

	return {
		text,
		stylePrefix,
		innerPrefix: stylePrefix + contentPrefix,
		mentionLength,
		mentionEntity,
	}
}

/**
 * 渲染 [rangeStart, rangeEnd) 内嵌套/同段实体（TG 允许嵌套与同段叠加，禁止部分重叠）。
 * @param {string} text 原始文本
 * @param {TelegramMessageEntity[]} entities 候选实体
 * @param {number} rangeStart UTF-16 起点
 * @param {number} rangeEnd UTF-16 终点
 * @param {number} markdownBase 已输出 Markdown 的 UTF-16 长度
 * @returns {{ text: string, mentionEntities: TelegramMessageEntity[] }}
 */
function renderTelegramEntityRange(text, entities, rangeStart, rangeEnd, markdownBase) {
	/** @type {string[]} */
	const parts = []
	/** @type {TelegramMessageEntity[]} */
	const mentionEntities = []
	const contained = entities
		.filter(entity => entity.offset >= rangeStart && entity.offset + entity.length <= rangeEnd)
		.sort((a, b) => a.offset - b.offset || b.length - a.length)

	let cursor = rangeStart
	let i = 0
	while (i < contained.length) {
		const entity = contained[i]
		if (entity.offset < cursor) {
			i++
			continue
		}
		if (entity.offset > cursor)
			parts.push(utf16Slice(text, cursor, entity.offset - cursor))

		const spanStart = entity.offset
		const spanEnd = entity.offset + entity.length
		/** @type {TelegramMessageEntity[]} */
		const exactSpan = []
		while (i < contained.length && contained[i].offset === spanStart && contained[i].offset + contained[i].length === spanEnd)
			exactSpan.push(contained[i++])

		const nested = contained.filter(candidate =>
			candidate.offset >= spanStart && candidate.offset + candidate.length <= spanEnd
			&& !(candidate.offset === spanStart && candidate.offset + candidate.length === spanEnd)
		)
		const partBase = markdownBase + utf16Length(parts.join(''))
		const innerRendered = nested.length
			? renderTelegramEntityRange(text, nested, spanStart, spanEnd, partBase)
			: { text: utf16Slice(text, spanStart, spanEnd - spanStart), mentionEntities: [] }
		const formatted = applyTelegramSpanFormats(innerRendered.text, exactSpan)

		const mentionSource = formatted.mentionEntity || exactSpan.find(item => item.type === 'mention')
		if (mentionSource)
			mentionEntities.push({
				...mentionSource,
				offset: partBase + formatted.stylePrefix,
				length: formatted.mentionEntity
					? formatted.mentionLength
					: utf16Length(innerRendered.text),
			})
		else
			for (const nestedMention of innerRendered.mentionEntities)
				mentionEntities.push({
					...nestedMention,
					offset: nestedMention.offset + formatted.innerPrefix,
				})

		parts.push(formatted.text)
		cursor = spanEnd
	}
	if (cursor < rangeEnd)
		parts.push(utf16Slice(text, cursor, rangeEnd - cursor))

	return { text: parts.join(''), mentionEntities }
}

/**
 * @param {string | undefined} text - 原始消息文本。
 * @param {TelegramMessageEntity[] | undefined} entities - Telegram 消息实体数组。
 * @param {TelegramBotInfo | undefined} botInfo - bot自身信息。
 * @param {TelegramMessageType | undefined} replyToMessage - 被回复的 Telegram 消息对象。
 * @returns {{ text: string, mentionEntities: TelegramMessageEntity[] }} Markdown 与重映射后的 mention 实体。
 */
function telegramEntitiesToAiMarkdownMapped(text, entities, botInfo, replyToMessage) {
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
	if (!text) return { text: aiMarkdown.trim(), mentionEntities: [] }
	if (!entities?.length) return { text: (aiMarkdown + text).trim(), mentionEntities: [] }

	const rendered = renderTelegramEntityRange(text, entities, 0, text.length, utf16Length(aiMarkdown))
	aiMarkdown += rendered.text
	const leadWs = aiMarkdown.match(/^\s*/u)?.[0] || ''
	const leadUtf16 = utf16Length(leadWs)
	return {
		text: aiMarkdown.trim(),
		mentionEntities: rendered.mentionEntities.map(entity => ({
			...entity,
			offset: entity.offset - leadUtf16,
		})).filter(entity => entity.offset >= 0),
	}
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
	return telegramEntitiesToAiMarkdownMapped(text, entities, botInfo, replyToMessage).text
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
		/(<pre[\S\s]*?<\/pre>|<code>[\S\s]*?<\/code>)|\*\*(.+?)\*\*|(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)|__(.+?)__|~~(.+?)~~/g,
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
 * 类型别名。
 * @typedef {{ name: string, buffer: Buffer, mime_type: string, description: string }} TelegramResolvedFile_t
 */
/**
 * 惰性附件槽：构造时不下载，调用 loader 时再 `fetch`（bridge DTO 路径会在组装时立即解析）。
 * @typedef {() => Promise<TelegramResolvedFile_t | undefined>} TelegramLazyFileLoader_t
 */

/**
 * 从上下文中取出 Telegram Bot API 客户端。
 * @param {import('npm:telegraf').Context} context - Telegraf 上下文。
 * @returns {import('npm:telegraf').Telegram | undefined} `context.telegram` 或等价 accessor。
 */
function getTelegramApiFromContext(context) {
	return context.telegram || (context.botInfo ? context : null)?.telegram
}

/**
 * 为单条消息构造惰性下载任务数组（每个元素为返回单文件或 `undefined` 的异步函数）。
 * @param {import('npm:telegraf').Context} context - Telegraf 上下文。
 * @param {TelegramMessageType} message - Telegram 消息对象。
 * @returns {TelegramLazyFileLoader_t[]} 每个元素为「执行时下载单附件」的异步函数。
 */
export function createLazyTelegramMessageFileLoaders(context, message) {
	/**
	 * Telegram 附件懒加载器列表。
	 * @type {TelegramLazyFileLoader_t[]}
	 */
	const loaders = []
	const telegramApi = getTelegramApiFromContext(context)
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


	return messages.filter(line => line.trim().length)
}

/**
 * 将 Telegram text_mention / @BotUsername mention 实体改写为 fount `@[hash]` token。
 * @param {string} username replica
 * @param {string | undefined} text 原始正文
 * @param {TelegramMessageEntity[] | undefined} entities 实体列表
 * @param {TelegramBotInfo | null} [botInfo] bot 信息（用于匹配 @BotUsername）
 * @returns {Promise<string>} 改写后正文
 */
export async function rewriteTelegramMentionsToFount(username, text, entities, botInfo = null) {
	if (!text || !entities?.length) return text || ''
	const { resolveBridgeIdentity } = await import('../../chat/src/chat/bridge/identity.mjs')
	const botUsername = String(botInfo?.username || '').replace(/^@/, '').toLowerCase()
	const botId = botInfo?.id

	/** @type {Array<{ offset: number, length: number, platformUserId: string | number, displayName: string }>} */
	const rewrites = []
	for (const entity of entities) {
		if (entity.type === 'text_mention' && entity.user?.id != null) {
			rewrites.push({
				offset: entity.offset,
				length: entity.length,
				platformUserId: entity.user.id,
				displayName: entity.user.first_name || entity.user.username || '',
			})
			continue
		}
		if (entity.type === 'mention' && botUsername && botId != null) {
			const mentionText = utf16Slice(text, entity.offset, entity.length)
			const handle = mentionText.replace(/^@/, '').toLowerCase()
			if (handle === botUsername)
				rewrites.push({
					offset: entity.offset,
					length: entity.length,
					platformUserId: botId,
					displayName: botInfo.username || '',
				})
		}
	}
	const sorted = rewrites.sort((a, b) => b.offset - a.offset)
	let result = text
	for (const entity of sorted) {
		const hash = await resolveBridgeIdentity(
			username,
			'telegram',
			entity.platformUserId,
			entity.displayName,
		)
		const token = formatEntityMentionToken(hash)
		result = utf16Replace(result, entity.offset, entity.length, token)
	}
	return result
}

/**
 * 出站：fount `@[hash]` → Telegram 纯文本 + text_mention entities。
 * @param {string} username replica
 * @param {string} text 含 fount token 的正文
 * @returns {Promise<{ text: string, entities: TelegramMessageEntity[] }>} 出站文本与实体
 */
export async function buildTelegramTextAndEntities(username, text) {
	const { lookupBridgeEntityReverse } = await import('../../chat/src/chat/bridge/identity.mjs')
	/** @type {TelegramMessageEntity[]} */
	const entities = []
	let output = ''
	let lastIndex = 0
	const re = new RegExp(FOUNT_ENTITY_MENTION_RE.source, 'gi')
	for (const match of text.matchAll(re)) {
		const start = match.index ?? 0
		output += text.slice(lastIndex, start)
		const hash = String(match[1]).toLowerCase()
		const rev = lookupBridgeEntityReverse(username, hash)
		if (rev?.platform === 'telegram') {
			const mentionText = rev.displayName || `User_${rev.platformUserId}`
			const offset = utf16Length(output)
			entities.push({
				type: 'text_mention',
				offset,
				length: utf16Length(mentionText),
				user: {
					id: Number(rev.platformUserId),
					is_bot: false,
					first_name: mentionText,
				},
			})
			output += mentionText
		}
		else 
			output += rev?.displayName || hash.slice(64, 72)
		
		lastIndex = start + match[0].length
	}
	output += text.slice(lastIndex)
	return { text: output, entities }
}

/**
 * 出站：fount `@[hash]` 还原为可读文本（无 entities）。
 * @param {string} username replica
 * @param {string} text 正文
 * @returns {Promise<string>} 还原后正文
 */
export async function restoreFountMentionsInText(username, text) {
	if (!text) return ''
	const { lookupBridgeEntityReverse } = await import('../../chat/src/chat/bridge/identity.mjs')
	const re = new RegExp(FOUNT_ENTITY_MENTION_RE.source, 'gi')
	let result = ''
	let lastIndex = 0
	for (const match of text.matchAll(re)) {
		const start = match.index ?? 0
		result += text.slice(lastIndex, start)
		const hash = String(match[1]).toLowerCase()
		const rev = lookupBridgeEntityReverse(username, hash)
		if (rev?.platform === 'telegram')
			result += `@${rev.displayName || rev.platformUserId}`
		else
			result += rev?.displayName || hash.slice(64, 72)
		lastIndex = start + match[0].length
	}
	result += text.slice(lastIndex)
	return result
}

/**
 * @param {import('npm:telegraf').Context} context Telegraf 上下文
 * @param {TelegramMessageType} message Telegram 消息
 * @param {TelegramBotInfo} botInfo bot 信息
 * @param {string} ownerUsername replica
 * @returns {Promise<object | null>} bridge DTO
 */
export async function telegramMessageToBridgeDto(context, message, botInfo, ownerUsername) {
	if (!message?.from) return null
	const rawText = message.text || message.caption || ''
	const entities = message.entities || message.caption_entities
	const mapped = telegramEntitiesToAiMarkdownMapped(rawText, entities, botInfo, message.reply_to_message)
	let text = await rewriteTelegramMentionsToFount(ownerUsername, mapped.text, mapped.mentionEntities, botInfo)
	if (message.sticker) {
		const { sticker } = message
		const stickerDesc = `<:${sticker.file_id}:${sticker.set_name || 'unknown_set'}:${sticker.emoji || ''}>`
		text = [text, stickerDesc].filter(Boolean).join('\n\n')
	}
	const lazyFiles = createLazyTelegramMessageFileLoaders(context, message)
	/** @type {Array<{ name?: string, mime_type?: string, buffer: Buffer }>} */
	const files = []
	for (const loader of lazyFiles) {
		if (typeof loader !== 'function') continue
		const loaded = await loader()
		if (loaded?.buffer?.byteLength)
			files.push({
				name: loaded.name || 'file',
				mime_type: loaded.mime_type || 'application/octet-stream',
				buffer: loaded.buffer,
			})
	}
	if (!text.trim() && !files.length) return null

	const baseName = [
		message.from.first_name,
		message.from.last_name,
	].filter(Boolean).join(' ').trim()
		|| message.from.username
		|| `User_${message.from.id}`
	const displayName = baseName

	return {
		platform: 'telegram',
		platformChatId: message.chat.id,
		platformThreadId: message.message_thread_id,
		platformMessageId: message.message_id,
		chatKind: message.chat.type === 'private' ? 'dm' : 'group',
		chatName: message.chat.title || String(message.chat.id),
		author: {
			platformUserId: message.from.id,
			displayName,
		},
		text,
		files: files.length ? files : undefined,
		replyToPlatformMessageId: message.reply_to_message?.message_id,
		timestamp: (message.edit_date ?? message.date) * 1000,
	}
}

/**
 * 相册合并为单条 bridge DTO。
 * @param {import('npm:telegraf').Context} context Telegraf 上下文
 * @param {TelegramMessageType[]} messages 相册分片
 * @param {string} ownerUsername replica
 * @returns {Promise<object | null>} bridge DTO
 */
export async function telegramMediaGroupToBridgeDto(context, messages, ownerUsername) {
	if (!messages?.length) return null
	const sorted = [...messages].sort((a, b) => a.message_id - b.message_id)
	const primary = sorted[0]
	const { content } = extractMediaGroupContentParts(sorted, undefined, {})
	const text = content
	const files = sorted.flatMap(message => createLazyTelegramMessageFileLoaders(context, message))
	const resolvedFiles = []
	for (const loader of files) {
		if (typeof loader !== 'function') continue
		const loaded = await loader()
		if (loaded?.buffer?.byteLength)
			resolvedFiles.push({
				name: loaded.name || 'file',
				mime_type: loaded.mime_type || 'application/octet-stream',
				buffer: loaded.buffer,
			})
	}
	if (!text.trim() && !resolvedFiles.length) return null
	const from = primary.from
	const baseName = [
		from.first_name,
		from.last_name,
	].filter(Boolean).join(' ').trim()
		|| from.username
		|| `User_${from.id}`
	const displayName = baseName
	return {
		platform: 'telegram',
		platformChatId: primary.chat.id,
		platformThreadId: primary.message_thread_id,
		platformMessageId: primary.message_id,
		chatKind: primary.chat.type === 'private' ? 'dm' : 'group',
		chatName: primary.chat.title || String(primary.chat.id),
		author: {
			platformUserId: from.id,
			displayName,
		},
		text,
		files: resolvedFiles.length ? resolvedFiles : undefined,
		replyToPlatformMessageId: sorted.find(message => message.reply_to_message)?.reply_to_message?.message_id,
		timestamp: Math.max(...sorted.map(message => (message.edit_date ?? message.date) * 1000)),
	}
}
