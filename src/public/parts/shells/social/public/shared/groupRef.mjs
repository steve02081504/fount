/** Chat Markdown 群链标记（与 chat shared expandChannelLinks 一致）。 */
const GROUP_REF_MARKDOWN_RE = /#\[[\w.-]+\/[\w.-]+]/g

/**
 * @param {string} groupId 群 ID
 * @param {string} [channelId] 频道 ID
 * @returns {string} Hub hash 链接
 */
function formatChatGroupHref(groupId, channelId = 'default') {
	return `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)}`
}

/**
 * @param {string} groupId 群 id
 * @param {string} [channelId='default'] 频道 id
 * @returns {string} `#[groupId/channelId]` 标记
 */
export function formatGroupRefMarkdownToken(groupId, channelId = 'default') {
	const channel = channelId?.trim() || 'default'
	return `#[${groupId}/${channel}]`
}

/**
 * @param {string} text 正文
 * @returns {string} 去掉群链标记后的正文
 */
export function stripGroupRefMarkdownTokens(text) {
	return String(text || '')
		.replace(GROUP_REF_MARKDOWN_RE, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
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
