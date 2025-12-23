/**
 * 将流切片应用到消息对象上，更新消息内容和文件。
 * @param {object} message - 消息对象，将被修改。
 * @param {object} slice - 流切片对象。
 * @returns {object} - 更新后的消息对象。
 */
export function applySlice(message, slice) {
	message.content = message.content || ''

	switch (slice.type) {
		case 'append':
			message.content += slice.add.content
			if (slice.add.files)
				message.files = message.files.concat(slice.add.files)

			break
		case 'rewrite_tail': {
			// 健壮处理：如果 index 超出范围，回退到追加
			const safeIndex = Math.min(slice.index, message.content.length)
			message.content = message.content.substring(0, safeIndex) + slice.content
			break
		}
		case 'set_files':
			message.files = slice.files
			break
	}
	return message
}
