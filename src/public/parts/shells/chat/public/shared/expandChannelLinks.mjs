const CHANNEL_LINK_PATTERN = /#\[([\w.-]+)\/([\w.-]+)]/g
const GROUP_LINK_PATTERN = /#\[([\w.-]+)](?!\/)/g

/**
 * @param {string} groupId 群 ID
 * @param {string} [channelId] 频道 ID
 * @returns {string} Hub hash 链接
 */
export function formatChatGroupHref(groupId, channelId = 'default') {
	return `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)}`
}

/**
 * @param {string} text 原始文本
 * @returns {string} 展开后的 Markdown
 */
export function expandChannelLinksInText(text) {
	return text
		.replace(CHANNEL_LINK_PATTERN, (...[, groupId, channelId]) =>
			`[#${groupId}/${channelId}](${formatChatGroupHref(groupId, channelId)})`,
		)
		.replace(GROUP_LINK_PATTERN, (...[, groupId]) =>
			`[#${groupId}](${formatChatGroupHref(groupId)})`,
		)
}
