/**
 * 将流切片应用到消息对象上，更新消息内容和文件。
 * @param {object} message - 消息对象，将被修改。
 * @param {object} slice - 流切片对象。
 * @returns {object} - 更新后的消息对象。
 */
export function applySlice(message, slice) {
	switch (slice.type) {
		case 'append':
			for (const key of ['content_for_show', 'content']) if (slice.add[key]) {
				message[key] ??= ''
				message[key] += slice.add[key]
			}
			if (slice.add.files)
				message.files = (message.files ?? []).concat(slice.add.files)
			break
		case 'rewrite_tail': {
			const key = slice.field
			message[key] ??= ''
			const safeIndex = Math.min(slice.index, message[key].length)
			message[key] = message[key].substring(0, safeIndex) + slice.content
			break
		}
		case 'set_files':
			message.files = slice.files
			break
	}
	return message
}
