import { senderColor } from './dagMessageUtils.mjs'

/**
 *
 */
export { DEFAULT_AVATAR } from '../utils.mjs'

/**
 * 群聊等场景下的圆形头像：有 URL 时用图片，失败或无 URL 时用彩色首字母占位。
 * 颜色与字母规则与原先 `messageItem` 一致（`senderColor` + 名前 2 字符大写），以保持视觉效果。
 * @param {string} name 显示名或发送者标识
 * @param {string | null | undefined} [avatarUrl] 头像地址；空则直接渲染字母头像
 * @returns {HTMLElement} 根节点为 `img` 或字母占位的 `div`
 */
export function createAvatarElement(name, avatarUrl) {
	const displayName = String(name || '?')
	const trimmed = typeof avatarUrl === 'string' ? avatarUrl.trim() : ''
	const frameClass = 'shrink-0 w-8 h-8 rounded-full mt-0.5'

	/**
	 * @returns {HTMLDivElement} 双字母圆形占位元素
	 */
	function buildInitialsEl() {
		const el = document.createElement('div')
		el.className = `${frameClass} flex items-center justify-center text-xs font-bold text-white`
		el.style.backgroundColor = senderColor(displayName)
		el.textContent = displayName.slice(0, 2).toUpperCase()
		return el
	}

	if (!trimmed)
		return buildInitialsEl()

	const img = document.createElement('img')
	img.src = trimmed
	img.alt = displayName
	img.className = `${frameClass} object-cover`
	/**
	 *
	 */
	img.onerror = () => {
		img.replaceWith(buildInitialsEl())
	}
	return img
}
