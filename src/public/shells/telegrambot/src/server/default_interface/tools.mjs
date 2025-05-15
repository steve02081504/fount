import { Buffer } from 'node:buffer'
import { getPartInfo } from '../../../../../../scripts/locale.mjs'

/**
 * 将 Telegram 的消息上下文转换为 Fount 的聊天日志条目格式。
 * @param {import('npm:telegraf').Context} ctx - Telegraf 的消息上下文。
 * @param {import('npm:telegraf').NarrowedContext<import('npm:telegraf').Context, import('npm:telegraf').Types.Update.MessageUpdate>} messageCtx - 特指消息更新的上下文
 * @param {import('npm:telegraf/typings/core/types/typegram').UserFromGetMe} botInfo - 机器人自身的信息。
 * @param {any} interfaceConfig - 传递给此接口的特定配置 (例如 OwnerUserID)。
 * @param {charAPI_t} charAPI - 当前角色的API对象。
 * @param {string} ownerUsername - Fount系统的用户名。
 * @param {string} botCharname - 当前机器人绑定的角色名。
 * @returns {Promise<chatLogEntry_t_simple | null>} 转换后的聊天日志条目，或在无法处理时返回 null。
 *
 * @typedef {import('../../../../../../decl/charAPI.ts').charAPI_t} charAPI_t
 * @typedef {import('../../../../chat/decl/chatLog.ts').chatLogEntry_t} FountChatLogEntryBase
 * @typedef { (FountChatLogEntryBase & {
 *  extension?: {telegram_message_id?: number, telegram_chat_id?: number, telegram_user_id?: number, [key: string]: any }
 * })} chatLogEntry_t_simple
 */
export async function TelegramMessageToFountChatLogEntry(ctx, messageCtx, botInfo, interfaceConfig, charAPI, ownerUsername, botCharname) {
	if (!messageCtx || !messageCtx.message) return null // 只处理消息类型

	const { message } = messageCtx
	const fromUser = message.from
	const { chat } = message

	// 确定角色 (role)
	let role = 'char' // 默认视为与角色自身或其他用户对话
	if (fromUser.id === botInfo.id)
		role = 'char' // 机器人自己发的消息
	else if (interfaceConfig.OwnerUserID && fromUser.id.toString() === interfaceConfig.OwnerUserID.toString())
		role = 'user' // 配置的机器人拥有者

	// 如果以上都不是，则role保持为'char'，表示是其他用户与机器人交互

	// 获取说话者名称
	let name = fromUser.first_name || ''
	if (fromUser.last_name) name += ` ${fromUser.last_name}`
	if (!name.trim() && fromUser.username) name = fromUser.username
	if (!name.trim()) name = `User_${fromUser.id}` // 最后备选

	// 机器人自己的名字
	const botDisplayName = (await getPartInfo(charAPI)).name || botCharname

	// 内容提取
	let content = ''
	if ('text' in message) content = message.text || ''
	if ('caption' in message && message.caption)
		content = content ? `${content}\n${message.caption}` : message.caption


	// 文件处理
	const files = []
	try {
		if ('photo' in message && message.photo) {
			// message.photo 是一个 PhotoSize 数组，选择最大的那个
			const photo = message.photo.reduce((prev, current) => (prev.file_size || 0) > (current.file_size || 0) ? prev : current)
			const fileLink = await ctx.telegram.getFileLink(photo.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: `${photo.file_unique_id}.jpg`, // 使用 unique_id 保证文件名唯一性
				buffer,
				mimeType: 'image/jpeg', // Telegram 通常是 jpeg
				description: content // 如果内容是图片的caption，可以作为描述
			})
			if (message.caption === content) content = '' // 如果caption已经作为文件名，则清空文本内容避免重复
		} else if ('document' in message && message.document) {
			const doc = message.document
			const fileLink = await ctx.telegram.getFileLink(doc.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: doc.file_name || `${doc.file_unique_id}`,
				buffer,
				mimeType: doc.mime_type || 'application/octet-stream',
				description: content
			})
			if (message.caption === content) content = ''
		} else if ('voice' in message && message.voice) {
			const { voice } = message
			const fileLink = await ctx.telegram.getFileLink(voice.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: `${voice.file_unique_id}.ogg`, // Telegram 语音通常是 ogg
				buffer,
				mimeType: voice.mime_type || 'audio/ogg',
				description: '语音消息'
			})
		} else if ('audio' in message && message.audio) {
			const { audio } = message
			const fileLink = await ctx.telegram.getFileLink(audio.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: audio.file_name || `${audio.file_unique_id}.${audio.mime_type?.split('/')[1] || 'mp3'}`,
				buffer,
				mimeType: audio.mime_type || 'audio/mpeg',
				description: audio.title || '音频文件'
			})
		} else if ('video' in message && message.video) {
			const { video } = message
			const fileLink = await ctx.telegram.getFileLink(video.file_id)
			const response = await fetch(fileLink.href)
			const buffer = Buffer.from(await response.arrayBuffer())
			files.push({
				name: video.file_name || `${video.file_unique_id}.${video.mime_type?.split('/')[1] || 'mp4'}`,
				buffer,
				mimeType: video.mime_type || 'video/mp4',
				description: '视频文件'
			})
		}
		// 可以根据需要添加对更多类型文件（如 video_note, sticker 等）的处理
	} catch (error) {
		console.error(`[TelegramDefaultInterface] Failed to process file for message ${message.message_id}:`, error)
		// 即使文件处理失败，也尝试继续处理文本内容
	}


	// 如果没有文本内容且没有文件，则认为消息无效 (例如，用户加入群组的通知)
	if (!content.trim() && files.length === 0) {
		// 特殊处理: 如果是回复，且没有内容，可能需要保留上下文
		if (message.reply_to_message)
			// content = `(回复消息 ${message.reply_to_message.message_id})`
			// 对于这种情况，我们可能不希望生成一个空的聊天日志条目，除非AI需要知道这个回复动作本身
			// 暂时返回null，除非有明确需求处理空回复
			return null

		return null
	}


	/** @type {chatLogEntry_t_simple} */
	const entry = {
		timeStamp: message.date * 1000, // Telegram 时间戳是秒，转换为毫秒
		role,
		name: role === 'char' && fromUser.id === botInfo.id ? botDisplayName : name,
		content,
		files,
		extension: {
			telegram_message_id: message.message_id,
			telegram_chat_id: chat.id,
			telegram_user_id: fromUser.id,
			// 如果是回复消息，可以记录被回复消息的ID
			...message.reply_to_message && { telegram_reply_to_message_id: message.reply_to_message.message_id }
		}
	}
	return entry
}


/**
 * 将长消息分割成符合 Telegram 消息长度限制的片段。
 * Telegram 消息长度限制通常为 4096 个字符。
 * @param {string} reply - 原始回复文本。
 * @param {number} [split_length=4000] - 分割长度，略小于 Telegram 限制以保留余地。
 * @returns {string[]} 分割后的消息片段数组。
 */
export function splitTelegramReply(reply, split_length = 4000) {
	if (!reply) return []
	if (reply.length <= split_length) return [reply]

	const parts = []
	let currentPart = ''

	// 优先按换行符分割
	const lines = reply.split('\n')
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		// 如果当前行加上换行符就超过限制，或者当前行本身就超过限制
		if ((currentPart.length + line.length + 1 > split_length && currentPart.length > 0) || line.length > split_length)
			// 如果当前行本身就超长，需要硬分割
			if (line.length > split_length) {
				if (currentPart.length > 0) {
					parts.push(currentPart)
					currentPart = ''
				}
				// 硬分割超长行
				for (let j = 0; j < line.length; j += split_length)
					parts.push(line.substring(j, j + split_length))

			} else {
				// 当前行不超长，但加上它会使 currentPart 超长
				parts.push(currentPart)
				currentPart = line
			}
		else {
			if (currentPart.length > 0)
				currentPart += '\n'

			currentPart += line
		}
	}

	if (currentPart.length > 0)
		parts.push(currentPart)


	// 最终检查，确保没有片段超过理论最大值（4096）
	// （虽然我们用 split_length = 4000 来预防，但以防万一）
	const finalParts = []
	const hardLimit = 4096
	for (const part of parts)
		if (part.length > hardLimit)
			for (let i = 0; i < part.length; i += hardLimit)
				finalParts.push(part.substring(i, i + hardLimit))

		else
			finalParts.push(part)




	return finalParts.filter(p => p.trim().length > 0)
}
