/**
 * 【文件】public/src/lib/emojiSvg.mjs
 * 【职责】Iconify CDN SVG 表情/图标 URL 与 img 标签辅助、Hub 空状态图标。
 * 【原理】iconifyUrl 拼 api.iconify.design；iconifyImg 生成带 class 的 <img> 字符串。
 * 【数据结构】icon id 如 line-md/chat-round；opts { class, alt }。
 * 【关联】Hub UI 模板；unicodeEmojiData 互补。
 */
const ICONIFY_CDN = 'https://api.iconify.design'

/**
 * Iconify SVG CDN URL.
 * @param {string} icon Set/icon id (e.g. `line-md/chat-round` or `mdi/pound`)
 * @returns {string} Absolute Iconify SVG URL.
 */
export function iconifyUrl(icon) {
	const path = icon.includes('/') ? icon : `mdi/${icon}`
	return `${ICONIFY_CDN}/${path}.svg`
}

/**
 * Inline `<img>` pointing at Iconify CDN (decorative UI icons, not Unicode emoji glyphs).
 * @param {string} icon Set/icon id
 * @param {{ class?: string, width?: number, height?: number, alt?: string }} [opts] img attributes
 * @returns {string} Inline `<img>` HTML.
 */
export function iconifyImg(icon, opts = {}) {
	const {
		class: className = '',
		width = 24,
		height = 24,
		alt = '',
	} = opts
	const cls = className ? ` class="${className}"` : ''
	return `<img src="${iconifyUrl(icon)}"${cls} width="${width}" height="${height}" alt="${alt}" aria-hidden="true" />`
}

/** Hub empty-state icons */
export const hubEmptyChatIcon = iconifyImg('line-md/chat-round', { class: 'hub-empty-icon-img', width: 48, height: 48 })
/** Hub 空状态：挥手图标 HTML */
export const hubEmptyWaveIcon = iconifyImg('line-md/waving', { class: 'hub-empty-icon-img', width: 48, height: 48 })
/** Hub 空状态：角色列表图标 HTML */
export const hubEmptyCharsIcon = iconifyImg('mdi/robot-outline', { class: 'hub-empty-icon-img', width: 48, height: 48 })
/** Hub 空状态：频道/列表图标 HTML */
export const hubEmptyListIcon = iconifyImg('line-md/list-indented', { class: 'hub-empty-icon-img', width: 48, height: 48 })

/** Message action bar icons */
export const hubActionBookmarkIcon = iconifyImg('mdi/bookmark-outline', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：置顶图标 */
export const hubActionPinIcon = iconifyImg('mdi/pin', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：取消置顶图标 */
export const hubActionUnpinIcon = iconifyImg('mdi/pin-off-outline', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：点赞图标 */
export const hubActionThumbUpIcon = iconifyImg('mdi/thumb-up-outline', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：点踩图标 */
export const hubActionThumbDownIcon = iconifyImg('mdi/thumb-down-outline', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：删除图标 */
export const hubActionDeleteIcon = iconifyImg('line-md/remove', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：编辑图标 */
export const hubActionEditIcon = iconifyImg('line-md/edit', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：重新生成图标 */
export const hubActionRegenIcon = iconifyImg('line-md/rotate-270', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：子线程图标 */
export const hubActionThreadIcon = iconifyImg('mdi/forum-outline', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：复制链接/引用图标 */
export const hubActionCopyIcon = iconifyImg('line-md/document-list', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：复制纯文本图标 */
export const hubActionCopyTextIcon = iconifyImg('line-md/document', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：复制 HTML 图标 */
export const hubActionCopyHtmlIcon = iconifyImg('line-md/document-code', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：下载附件图标 */
export const hubActionDownloadIcon = iconifyImg('line-md/download', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：分享图标 */
export const hubActionShareIcon = iconifyImg('line-md/external-link', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：更多菜单图标 */
export const hubActionMenuIcon = iconifyImg('mdi/dots-horizontal', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：时间线上一版图标 */
export const hubActionTimelinePrevIcon = iconifyImg('mdi/chevron-left', { width: 16, height: 16, class: 'hub-action-icon' })
/** 消息操作栏：时间线下一版图标 */
export const hubActionTimelineNextIcon = iconifyImg('mdi/chevron-right', { width: 16, height: 16, class: 'hub-action-icon' })
