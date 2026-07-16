/**
 * @param {string} groupId 群 ID
 * @param {string} [channelId] 频道 ID
 * @returns {string} Hub hash 链接
 */
function formatChatGroupHref(groupId, channelId = 'default') {
	return `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)}`
}

/**
 * @param {{ groupId: string, channelId?: string, label?: string }} groupRef 关联
 * @returns {string} 展示标签
 */
export function groupRefLabel(groupRef) {
	if (groupRef?.label) return groupRef.label
	const channelId = groupRef?.channelId?.trim() || 'default'
	return `#${groupRef?.groupId || ''}/${channelId}`
}

/**
 * @param {{ groupId: string, channelId?: string, label?: string }} groupRef 关联
 * @returns {string} 卡片 HTML
 */
export function renderGroupRefBlockHtml(groupRef) {
	if (!groupRef?.groupId) return ''
	const channelId = groupRef.channelId?.trim() || 'default'
	const href = formatChatGroupHref(groupRef.groupId, channelId)
	const label = groupRefLabel(groupRef)
	return `\
<div class="group-ref-block">
	<span class="group-ref-label">${label}</span>
	<a href="${href}" class="link-btn">${href}</a>
</div>
`
}
