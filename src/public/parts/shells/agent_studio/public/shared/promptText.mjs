/** 纯文本序列化：把 prompt 消息数组转成可复制 / 下载的文本。 */

/**
 * 将消息序列化为带角色名的纯文本，消息之间空行分隔。
 * @param {object[]} messages 消息列表（`{ role, name, content }`）
 * @returns {string} 文本
 */
export function messagesToText(messages) {
	return (messages ?? []).map(message => {
		const label = [message.role, message.name].filter(Boolean).join(' ')
		return `${label}: ${message.content ?? ''}`
	}).join('\n\n')
}
