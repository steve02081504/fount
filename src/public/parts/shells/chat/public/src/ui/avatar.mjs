/**
 * 【文件】public/src/ui/avatar.mjs
 * 【职责】圆形头像元素：图片 URL 或彩色首字母占位（与 Hub 配色一致）。
 * 【原理】createAvatarElement 创建 img，onerror 回退 div+avatarColor(name)。
 * 【数据结构】name 字符串、avatarUrl 可选。
 * 【关联】hub/core/domUtils.mjs；消息行、成员列表模板。
 */
import {
	avatarColor,
	avatarInitial,
	avatarTextColor,
} from '/parts/shells:chat/shared/hashAvatar.mjs'

/**
 * 群聊等场景下的圆形头像：有 URL 时用图片，失败或无 URL 时用 hash 文字头像。
 * @param {string} seed 身份键（entityHash / memberKey / 展示名）
 * @param {string | null | undefined} [avatarUrl] 头像地址；空则直接渲染字母头像
 * @param {string} [displayName] 字母展示名；默认同 seed
 * @returns {HTMLElement} 根节点为 `img` 或字母占位的 `div`
 */
export function createAvatarElement(seed, avatarUrl, displayName) {
	const avatarSeed = String(seed || '?')
	const label = String(displayName || avatarSeed)
	const trimmed = String(avatarUrl || '').trim()
	const frameClass = 'shrink-0 w-8 h-8 rounded-full mt-0.5'

	/**
	 * @returns {HTMLDivElement} 首字母圆形占位元素
	 */
	function buildInitialsElement() {
		const el = document.createElement('div')
		el.className = `${frameClass} flex items-center justify-center text-xs font-bold`
		el.style.backgroundColor = avatarColor(avatarSeed)
		el.style.color = avatarTextColor(avatarSeed)
		el.textContent = avatarInitial(label)
		return el
	}

	if (!trimmed)
		return buildInitialsElement()

	const img = document.createElement('img')
	img.src = trimmed
	img.alt = label
	img.className = `${frameClass} object-cover`
	/**
	 * 头像 URL 加载失败时回退为首字母占位。
	 * @returns {void}
	 */
	img.onerror = () => {
		img.replaceWith(buildInitialsElement())
	}
	return img
}
