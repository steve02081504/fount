/**
* @param {string} reply
* @returns {string[]}
*/
export function splitDiscordReply(reply, split_lenth = 2000) {
	let content_slices = reply.split('\n')
	let new_content_slices = []
	let last = ''
	function mapend() {
		if (last) new_content_slices.push(last)
		content_slices = new_content_slices
		new_content_slices = []
		last = ''
	}
	/**
	 * @param {string} code_block
	 * @param {string} split_line
	 */
	function splitCodeBlock(code_block, split_line) {
		let new_content_slices = []
		let content_slices = code_block.trim().split('\n')
		const block_begin = content_slices.shift() + '\n'
		const block_end = '\n' + content_slices.pop()
		// 找到分割行
		while (content_slices.length > 0) {
			const split_line_index = content_slices.indexOf(split_line)
			if (split_line_index === -1) {
				new_content_slices.push(content_slices.join('\n'))
				break
			}
			const before = content_slices.slice(0, split_line_index + 1).join('\n')
			new_content_slices.push(before)
			content_slices = content_slices.slice(split_line_index + 1)
		}
		content_slices = new_content_slices
		new_content_slices = []
		// 合并代码块
		let last = ''
		for (const content_slice of content_slices) {
			if (last.length + content_slice.length + block_begin.length + block_end.length > split_lenth) {
				new_content_slices.push(block_begin + last + block_end)
				last = ''
			}
			last += '\n' + content_slice
		}
		new_content_slices.push(block_begin + last + block_end)
		new_content_slices = new_content_slices.filter(e => e != block_begin + block_end)
		return new_content_slices
	}
	// 处理```代码块，合并块内容确保其在一个消息中
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
	// 处理超大代码块或超长单行，分割为多个块内容或多行
	code_handle:
	for (const content_slice of content_slices)
		if (content_slice.length > split_lenth)
			if (content_slice.startsWith('```')) {
				for (const spliter of ['}', '};', ')', '']) {
					const splited_blocks = splitCodeBlock(content_slice, spliter)
					if (splited_blocks.every(e => e.length <= split_lenth)) {
						new_content_slices = new_content_slices.concat(splited_blocks)
						continue code_handle
					}
				}
				new_content_slices.push(content_slice)
			}
			else {
				const splited_lines = content_slice.split(/(?<=[ !"');?\]}’”。》！）：；？])/)
				let last = ''
				for (const splited_line of splited_lines) {
					if (last.length + splited_line.length > split_lenth) {
						new_content_slices.push(last)
						last = ''
					}
					last += splited_line
				}
				if (last) new_content_slices.push(last)
			}
		else new_content_slices.push(content_slice)

	mapend()
	// 对于仍然超出长度的块，生硬拆分其内容
	for (const content_slice of content_slices)
		if (content_slice.length > split_lenth)
			new_content_slices = new_content_slices.concat(content_slice.match(new RegExp(`[^]{1,${split_lenth}}`, 'g')))
		else new_content_slices.push(content_slice)
	mapend()
	// 合并消息使其不超过split_lenth
	for (const content_slice of content_slices)
		if (last.length + content_slice.length < split_lenth)
			last += '\n' + content_slice
		else {
			new_content_slices.push(last)
			last = content_slice
		}
	mapend()
	return content_slices.map(e => e.trim()).filter(e => e)
}

function formatEmbed(embed) {
	let embedContent = ''
	if (embed.title) embedContent += embed.title + '\n'
	if (embed.description) embedContent += embed.description + '\n'
	for (const field of embed.fields || []) {
		if (field.name) embedContent += field.name + '\n'
		if (field.value) embedContent += field.value + '\n'
	}
	if (embed.footer?.text) embedContent += embed.footer.text + '\n'
	return embedContent ? '```\n' + embedContent + '```\n' : ''
}

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
