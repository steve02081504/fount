import { Buffer } from 'node:buffer'

import { ChannelType } from 'npm:discord.js'

/* eslint-disable jsdoc/require-param-description, jsdoc/require-param-type, jsdoc/require-returns, jsdoc/require-returns-description */

const FOUNT_ENTITY_MENTION_RE = /@\[([0-9a-f]{128})\]/gi

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
 * 分割 Discord 回复。
 * @param {string} reply 要分割的回复字符串
 * @param {number} [split_length] 分割长度
 * @returns {string[]} 分割后的字符串数组
 */
export function splitDiscordReply(reply, split_length = 2000) {
	let content_slices = reply.split('\n')
	let new_content_slices = []
	let last = ''

	/**
	 *
	 */
	function mapend() {
		if (last) new_content_slices.push(last)
		content_slices = new_content_slices
		new_content_slices = []
		last = ''
	}

	/**
	 *
	 * @param code_block
	 */
	function splitCodeBlock(code_block) {
		const slices = code_block.trim().split('\n')
		if (slices.length <= 2) return [code_block]

		const block_begin = slices.shift() + '\n'
		const block_end = '\n' + slices.pop()
		const max_content_length = split_length - block_begin.length - block_end.length
		const results = []
		let current_chunk = ''

		for (const line of slices) {
			if (line.length > max_content_length) {
				if (current_chunk)
					results.push(block_begin + current_chunk.trim() + block_end)
				current_chunk = ''
				const hard_splits = line.match(new RegExp(`[\\s\\S]{1,${max_content_length}}`, 'g')) || []
				for (const part of hard_splits)
					results.push(block_begin + part + block_end)
				continue
			}
			if ((current_chunk.length + line.length + 1) > max_content_length) {
				results.push(block_begin + current_chunk.trim() + block_end)
				current_chunk = line
			}
			else if (current_chunk)
				current_chunk += '\n' + line
			else
				current_chunk = line
		}
		if (current_chunk)
			results.push(block_begin + current_chunk.trim() + block_end)
		return results
	}

	for (const content_slice of content_slices)
		if (content_slice.startsWith('```'))
			if (last) {
				new_content_slices.push(last + '\n' + content_slice)
				last = ''
			}
			else last = content_slice
		else if (last)
			last += '\n' + content_slice
		else
			new_content_slices.push(content_slice)
	mapend()

	for (const content_slice of content_slices)
		if (content_slice.length > split_length)
			if (content_slice.startsWith('```'))
				new_content_slices.push(...splitCodeBlock(content_slice))
			else {
				const splited_lines = content_slice.split(/(?<=[ !"');?\]}’”。》！）：；？])/)
				let last_line_chunk = ''
				for (const splited_line of splited_lines) {
					if (last_line_chunk.length + splited_line.length > split_length) {
						new_content_slices.push(last_line_chunk)
						last_line_chunk = ''
					}
					last_line_chunk += splited_line
				}
				if (last_line_chunk) new_content_slices.push(last_line_chunk)
			}
		else
			new_content_slices.push(content_slice)
	mapend()

	for (const content_slice of content_slices)
		if (content_slice.length > split_length)
			if (content_slice.startsWith('```'))
				new_content_slices.push(...splitCodeBlock(content_slice))
			else
				new_content_slices.push(...content_slice.match(new RegExp(`[^]{1,${split_length}}`, 'g')))
		else
			new_content_slices.push(content_slice)
	mapend()

	for (const content_slice of content_slices) {
		if (!last) {
			last = content_slice
			continue
		}
		if (last.length + content_slice.length + 1 < split_length)
			last += '\n' + content_slice
		else {
			new_content_slices.push(last)
			last = content_slice
		}
	}
	mapend()
	return content_slices.map(e => e.trim()).filter(e => e)
}

/**
 *
 * @param embed
 */
function formatEmbed(embed) {
	let embedContent = ''
	if (embed.data?.author?.name)
		embedContent += embed.data.author.name + '\n'
	if (embed.title) embedContent += embed.title + '\n'
	if (embed.description) embedContent += embed.description + '\n'
	for (const field of embed.fields || []) {
		if (field.name) embedContent += field.name + '\n'
		if (field.value) embedContent += field.value + '\n'
	}
	if (embed.footer?.text) embedContent += embed.footer.text + '\n'
	return embedContent ? '```\n' + embedContent + '```\n' : ''
}

/**
 *
 * @param components
 */
function extractTextFromComponents(components) {
	if (!Array.isArray(components) || !components.length) return ''
	const parts = []
	for (const comp of components) {
		if (!comp) continue
		if (comp.data?.content) parts.push(comp.data.content)
		if (comp.data?.label) parts.push(comp.data.label)
		if (comp.components?.length)
			parts.push(extractTextFromComponents(comp.components))
		if (comp.accessory)
			parts.push(extractTextFromComponents([comp.accessory]))
	}
	return parts.filter(Boolean).join('\n')
}

/**
 *
 * @param message
 */
function formatMessageContent(message) {
	let content = message.content || ''
	for (const [_, value] of message.mentions?.users || new Map()) {
		const mentionTag = `<@${value.id}>`
		if (content.includes(mentionTag))
			content = content.replaceAll(mentionTag, `@${value.username}`)
		else
			content = `@${value.username} ${content}`
	}
	for (const embed of message.embeds || []) {
		const embedText = formatEmbed(embed)
		if (embedText) {
			if (content) content += '\n'
			content += embedText
		}
	}
	for (const attachment of message.attachments || [])
		if (attachment.url) {
			if (content) content += '\n'
			content += `[附件] ${attachment.url}\n`
		}
	if (message.components?.length) {
		const componentText = extractTextFromComponents(message.components)
		if (componentText) {
			if (content) content += '\n\n'
			content += componentText
		}
	}
	if (message.editedTimestamp) content += '（已编辑）'
	return content
}

/**
 * 获取完整的消息内容，包括附件和嵌入。
 * @param {import('npm:discord.js').Message} message Discord 消息
 * @param {import('npm:discord.js').Client} client Discord 客户端
 * @returns {Promise<string>} 完整正文
 */
export async function getMessageFullContent(message, client) {
	let fullContent = formatMessageContent(message)
	for (const referencedMessage of message.messageSnapshots.map(t => t)) {
		const refContent = formatMessageContent(referencedMessage, client)
		const authorName = referencedMessage.author?.username || '未知用户'
		if (fullContent) fullContent += '\n\n'
		fullContent += `（转发消息）\n${authorName}：${refContent}`
	}
	return fullContent
}

/**
 * 入站：Discord mention 语法 → fount token。
 * @param {string} username replica
 * @param {string} text 原始正文
 * @returns {Promise<string>} 改写后正文
 */
export async function rewriteDiscordMentionsToFount(username, text) {
	if (!text) return ''
	const { resolveBridgeIdentity } = await import('../../chat/src/chat/bridge/identity.mjs')
	let result = text
	const userMentionRe = /<@!?(\d+)>/g
	const matches = [...result.matchAll(userMentionRe)]
	for (const match of matches.reverse()) {
		const userId = match[1]
		const hash = await resolveBridgeIdentity(username, 'discord', userId, '')
		const token = `@[${hash}]`
		result = result.slice(0, match.index) + token + result.slice(match.index + match[0].length)
	}
	result = result.replace(/<@&\d+>/g, '@[everyone]')
	result = result.replace(/@everyone/gi, '@[everyone]')
	result = result.replace(/@here/gi, '@[here]')
	return result
}

/**
 * 出站：fount `@[hash]` → Discord mention 语法。
 * @param {string} username replica
 * @param {string} text 正文
 * @returns {Promise<string>} 还原后正文
 */
export async function restoreFountMentionsForDiscord(username, text) {
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
		if (rev?.platform === 'discord')
			result += `<@${rev.platformUserId}>`
		else
			result += rev?.displayName || hash.slice(64, 72)
		lastIndex = start + match[0].length
	}
	result += text.slice(lastIndex)
	return result
}

/**
 * @param {import('npm:discord.js').Message} message Discord 消息
 * @param {import('npm:discord.js').Client} client Discord 客户端
 * @param {string} ownerUsername replica
 * @returns {Promise<object | null>} bridge DTO
 */
export async function discordMessageToBridgeDto(message, client, ownerUsername) {
	let fullMessage = message
	if (fullMessage.partial) try {
		fullMessage = await tryFewTimes(() => message.fetch())
	}
	catch {
		return null
	}

	const { author } = fullMessage
	if (!author || author.bot) return null

	let displayName = author.globalName || author.username || `User_${author.id}`
	if (fullMessage.guild?.members) try {
		const member = fullMessage.member?.partial
			? await tryFewTimes(() => fullMessage.member.fetch())
			: fullMessage.member
		if (member?.displayName) displayName = member.displayName
	}
	catch { /* displayName fallback */ }

	const rawText = await getMessageFullContent(fullMessage, client)
	const text = await rewriteDiscordMentionsToFount(ownerUsername, rawText)
	const files = []
	const processedUrls = new Set()
	const allAttachments = [
		...fullMessage.attachments.values(),
		...fullMessage.messageSnapshots.values().flatMap(s => [...s.attachments.values()]),
	]
	for (const attachment of allAttachments)
		if (attachment?.url && !processedUrls.has(attachment.url)) {
			processedUrls.add(attachment.url)
			try {
				const buffer = Buffer.from(await tryFewTimes(() => fetch(attachment.url).then(r => r.arrayBuffer())))
				files.push({
					name: attachment.name,
					buffer,
					mime_type: attachment.contentType || 'application/octet-stream',
				})
			}
			catch { /* skip attachment */ }
		}

	for (const embed of fullMessage.embeds)
		for (const url of [embed.image?.url, embed.thumbnail?.url].filter(Boolean))
			if (!processedUrls.has(url)) {
				processedUrls.add(url)
				try {
					const buffer = Buffer.from(await tryFewTimes(() => fetch(url).then(r => r.arrayBuffer())))
					files.push({
						name: url.substring(url.lastIndexOf('/') + 1).split('?')[0] || 'embedded_image.png',
						buffer,
						mime_type: 'image/png',
					})
				}
				catch { /* skip embed image */ }
			}

	for (const [, sticker] of fullMessage.stickers)
		if (sticker.url && sticker.format !== 3 && !processedUrls.has(sticker.url)) {
			processedUrls.add(sticker.url)
			try {
				const buffer = Buffer.from(await tryFewTimes(() => fetch(sticker.url).then(r => r.arrayBuffer())))
				files.push({
					name: sticker.url.split('/').pop()?.split('?')[0] || `${sticker.name}.png`,
					buffer,
					mime_type: 'image/png',
				})
			}
			catch { /* skip sticker */ }
		}

	if (!text.trim() && !files.length) return null

	const isDm = fullMessage.channel.type === ChannelType.DM
	const platformChatId = isDm
		? fullMessage.channel.id
		: fullMessage.guild?.id || fullMessage.channel.id

	return {
		platform: 'discord',
		platformChatId,
		platformThreadId: isDm ? undefined : fullMessage.channel.id,
		platformMessageId: fullMessage.id,
		chatKind: isDm ? 'dm' : 'group',
		chatName: isDm
			? `DM:${author.tag || author.username}`
			: fullMessage.guild?.name || String(platformChatId),
		author: {
			platformUserId: author.id,
			displayName,
		},
		text,
		files: files.length ? files : undefined,
		replyToPlatformMessageId: fullMessage.reference?.messageId,
		timestamp: fullMessage.editedTimestamp || fullMessage.createdTimestamp,
	}
}
