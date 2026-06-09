/**
 * Social 帖子关联 Chat 群/频道（groupRef）。
 */

/** Chat Markdown 群链标记（与 expandChannelLinks 一致）。 */
const GROUP_REF_MARKDOWN_RE = /#\[[\w.-]+\/[\w.-]+]/g

/**
 * 生成 Chat 群链 Markdown 标记 `#[groupId/channelId]`。
 * @param {string} groupId 群 id
 * @param {string} [channelId='default'] 频道 id
 * @returns {string} `#[groupId/channelId]` 标记
 */
export function formatGroupRefMarkdownToken(groupId, channelId = 'default') {
	const channel = channelId?.trim() || 'default'
	return `#[${groupId}/${channel}]`
}

/**
 * 从正文中移除群链 Markdown 标记。
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
 * 生成 Chat Hub 群/频道深链 URL。
 * @param {string} groupId 群 id
 * @param {string} [channelId='default'] 频道 id
 * @returns {string} Hub 深链
 */
export function formatChatGroupHref(groupId, channelId = 'default') {
	const channel = channelId?.trim() || 'default'
	return `/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channel)}`
}

/**
 * 返回群关联的人类可读标签。
 * @param {{ groupId: string, channelId?: string, label?: string }} groupRef 关联
 * @returns {string} 展示标签
 */
export function groupRefLabel(groupRef) {
	if (groupRef?.label) return groupRef.label
	const channelId = groupRef?.channelId?.trim() || 'default'
	return `#${groupRef?.groupId || ''}/${channelId}`
}

/**
 * 渲染群关联卡片 HTML。
 * @param {{ groupId: string, channelId?: string, label?: string }} groupRef 关联
 * @returns {string} 卡片 HTML
 */
export function renderGroupRefBlockHtml(groupRef) {
	if (!groupRef?.groupId) return ''
	const channelId = groupRef.channelId?.trim() || 'default'
	const href = formatChatGroupHref(groupRef.groupId, channelId)
	const label = groupRefLabel(groupRef)
	return `
		<div class="group-ref-block">
			<span class="group-ref-label">${label}</span>
			<a href="${href}" class="link-btn">${href}</a>
		</div>
	`
}
