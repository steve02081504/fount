import {
	CHANNEL_TOKEN_RE,
	GROUP_TOKEN_RE,
	MESSAGE_TOKEN_RE,
} from './inlineTokenSyntax.mjs'

/**
 * @param {string} groupId 群 ID
 * @param {string | null} [channelId] 频道 ID；缺省时链接只含群（落地时自动选择频道）
 * @returns {string} Hub hash 链接
 */
export function formatChatGroupHref(groupId, channelId) {
	const base = `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}`
	return channelId ? `${base}:${encodeURIComponent(channelId)}` : base
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} messageId 消息 event id
 * @returns {string} Hub 深链（query `m` 供前端聚焦消息）
 */
export function formatChatMessageHref(groupId, channelId, messageId) {
	const path = `/parts/shells:chat/hub/?m=${encodeURIComponent(messageId)}`
	return `${path}#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)}`
}

/**
 * @param {string} text 原始文本
 * @returns {string} 展开后的 Markdown
 */
export function expandChannelLinksInText(text) {
	return text
		.replace(MESSAGE_TOKEN_RE, (...[, groupId, channelId, messageId]) =>
			`[#${groupId}/${channelId}/${messageId.slice(0, 8)}…](${formatChatMessageHref(groupId, channelId, messageId)})`,
		)
		.replace(CHANNEL_TOKEN_RE, (...[, groupId, channelId]) =>
			`[#${groupId}/${channelId}](${formatChatGroupHref(groupId, channelId)})`,
		)
		.replace(GROUP_TOKEN_RE, (...[, groupId]) =>
			`[#${groupId}](${formatChatGroupHref(groupId)})`,
		)
}
