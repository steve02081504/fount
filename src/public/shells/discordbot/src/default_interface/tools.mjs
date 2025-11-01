/**
 * @param {string} reply
 * @param {number} split_lenth
 * @returns {string[]}
 */
export function splitDiscordReply(reply, split_lenth = 2000) {
	let content_slices = reply.split('\n')
	let new_content_slices = []
	let last = ''

	/**
	 * @returns {void}
	 */
	function mapend() {
		if (last) new_content_slices.push(last)
		content_slices = new_content_slices
		new_content_slices = []
		last = ''
	}

	/**
	 * @param {string} code_block
	 * @returns {string[]}
	 */
	function splitCodeBlock(code_block) {
		const content_slices = code_block.trim().split('\n')
		if (content_slices.length <= 2) return [code_block] // 如果是空代码块或只有一行，直接返回

		const block_begin = content_slices.shift() + '\n'
		const block_end = '\n' + content_slices.pop()
		const max_content_length = split_lenth - block_begin.length - block_end.length

		const results = []
		let current_chunk = ''

		for (const line of content_slices) {
			// 检查单行是否超长，如果超长则需要硬分割
			if (line.length > max_content_length) {
				// 先把之前累积的块推入
				if (current_chunk)
					results.push(block_begin + current_chunk.trim() + block_end)

				current_chunk = ''

				// 对超长行进行硬分割
				const hard_splits = line.match(new RegExp(`[\\s\\S]{1,${max_content_length}}`, 'g')) || []
				for (const part of hard_splits)
					results.push(block_begin + part + block_end)

				continue // 继续下一行
			}

			if ((current_chunk.length + line.length + 1) > max_content_length) {
				results.push(block_begin + current_chunk.trim() + block_end)
				current_chunk = line
			}
			else
				if (current_chunk)
					current_chunk += '\n' + line
				else
					current_chunk = line
		}

		if (current_chunk)
			results.push(block_begin + current_chunk.trim() + block_end)
		return results
	}

	// --- 第一阶段：合并 ``` 代码块 ---
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

	// --- 第二阶段：处理超大块 ---
	for (const content_slice of content_slices)
		if (content_slice.length > split_lenth)
			if (content_slice.startsWith('```')) {
				const splited_blocks = splitCodeBlock(content_slice)
				new_content_slices.push(...splited_blocks) // 使用 push(...array) 来添加所有元素
			}
			else {
				// 对于超长普通文本，保留你的智能分割逻辑
				const splited_lines = content_slice.split(/(?<=[ !"');?\]}’”。》！）：；？])/)
				let last_line_chunk = ''
				for (const splited_line of splited_lines) {
					if (last_line_chunk.length + splited_line.length > split_lenth) {
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

	// --- 第三阶段：生硬拆分（作为最后防线）---
	// 这个阶段现在应该只会处理那些经过智能分割后仍然超长的“普通文本块”。
	for (const content_slice of content_slices)
		if (content_slice.length > split_lenth)
			// 检查是否是代码块（理论上不应该到这里，但作为保险）
			if (content_slice.startsWith('```'))
				// 如果万一有代码块漏到这里，再次调用 splitCodeBlock
				new_content_slices.push(...splitCodeBlock(content_slice))
			else
				// 对普通文本进行硬分割
				new_content_slices.push(...content_slice.match(new RegExp(`[^]{1,${split_lenth}}`, 'g')))
		else
			new_content_slices.push(content_slice)
	mapend()

	// --- 第四阶段：合并消息 ---
	for (const content_slice of content_slices) {
		if (!last) {
			last = content_slice
			continue
		}

		if (last.length + content_slice.length + 1 < split_lenth)  // +1 for the newline
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
 * @param {import('npm:discord.js').Embed} embed
 * @returns {string}
 */
function formatEmbed(embed) {
	let embedContent = ''
	if (embed.data)
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
 * @param {import('npm:discord.js').Message} message
 * @returns {string}
 */
function formatMessageContent(message) {
	let content = message.content || ''

	// 处理用户提及
	for (const [_, value] of message.mentions?.users || new Map()) {
		const mentionTag = `<@${value.id}>`
		if (content.includes(mentionTag))
			content = content.replaceAll(mentionTag, `@${value.username}`)
		else
			content = `@${value.username} ${content}`
	}

	// 添加 embed
	for (const embed of message.embeds || []) {
		const embedText = formatEmbed(embed)
		if (embedText) {
			if (content) content += '\n'
			content += embedText
		}
	}

	// 如果有附件，添加附件的信息 (这里假设附件类型有 url 属性)
	for (const attachment of message.attachments || [])
		if (attachment.url) {
			if (content) content += '\n'
			content += `[附件] ${attachment.url}\n`
		}

	// 如果已编辑
	if (message.edited_timestamp) content += '（已编辑）'

	return content
}

/**
 *
 * @param {import('npm:discord.js').Message} message
 * @param {import('npm:discord.js').Client} client
 * @returns {Promise<string>}
 */
export async function getMessageFullContent(message, client) {
	let fullContent = formatMessageContent(message)

	// 处理转发消息
	const referencedMessages = message.messageSnapshots.map(t => t)
	for (const referencedMessage of referencedMessages) {
		const refContent = formatMessageContent(referencedMessage, client)
		const authorName = referencedMessage.author?.username || '未知用户'
		if (fullContent) fullContent += '\n\n'
		fullContent += `（转发消息）\n${authorName}：${refContent}`
	}

	return fullContent
}
