/**
 * 【文件】public/src/lib/expandChannelLinks.mjs
 * 【职责】将 #[groupId/channelId] 与 #[groupId] 文本 token 转为 Hub Markdown 链接。
 * 【原理】CHANNEL_LINK_PATTERN、GROUP_LINK_PATTERN 全局替换为 /parts/shells:chat/hub/... 链接。
 * 【数据结构】输入纯文本 → 输出 Markdown 字符串。
 * 【关联】markdown_ext/index.mjs、chatMarkdownPlugins.mjs。
 */
const CHANNEL_LINK_PATTERN = /#\[([\w.-]+)\/([\w.-]+)]/g
const GROUP_LINK_PATTERN = /#\[([\w.-]+)](?!\/)/g

/**
 * 将 `#[groupId/channelId]` 与 `#[groupId]` 转为 Hub Markdown 链接。
 * @param {string} text 原始文本
 * @returns {string} 展开后的 Markdown
 */
export function expandChannelLinksInText(text) {
	const expanded = text.replace(CHANNEL_LINK_PATTERN, (...[, groupId, channelId]) =>
		`[#${groupId}/${channelId}](/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)})`,
	)
	return expanded.replace(GROUP_LINK_PATTERN, (...[, groupId]) =>
		`[#${groupId}](/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:default)`,
	)
}
