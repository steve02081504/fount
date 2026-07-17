/**
 * Hub 头像宿主绘制：hash 文字占位 + profile 图片/表情，消息/成员/悬浮卡/资料弹层共用。
 */
import {
	avatarColor,
	avatarInitial,
	avatarTextColor,
	isAvatarImageUrl,
} from '/parts/shells:chat/shared/hashAvatar.mjs'

/**
 *
 */
export { isAvatarImageUrl }

/**
 * 将宿主重置为 hash 文字占位头像。
 * @param {HTMLElement} host 圆形容器
 * @param {{ seed?: string, label?: string, letterId?: string, letterClass?: string }} options 绘制选项
 * @returns {HTMLSpanElement} 字母节点
 */
export function paintHashAvatarHost(host, { seed, label, letterId, letterClass = 'hub-avatar-letter' }) {
	const avatarSeed = String(seed || label || '?')
	const displayLabel = String(label || avatarSeed)
	host.dataset.avatarSeed = avatarSeed
	host.replaceChildren()
	const letter = document.createElement('span')
	if (letterId) letter.id = letterId
	if (letterClass) letter.className = letterClass
	letter.textContent = avatarInitial(displayLabel)
	host.appendChild(letter)
	host.style.background = avatarColor(avatarSeed)
	host.style.color = avatarTextColor(avatarSeed)
	return letter
}

/**
 * 在 hash 占位基础上应用 profile.avatar（URL 图 / 表情文本；加载失败回退字母）。
 * @param {HTMLElement} host 圆形容器
 * @param {{ seed?: string, label?: string, avatar?: string | null, emojiFontSize?: string, letterId?: string, letterClass?: string }} options 绘制选项
 * @returns {Promise<void>}
 */
export async function applyProfileAvatarToHost(host, options) {
	const {
		seed,
		label,
		avatar,
		emojiFontSize = '20px',
		letterId,
		letterClass,
	} = options
	const letter = paintHashAvatarHost(host, { seed, label, letterId, letterClass })
	const avatarVal = String(avatar || '').trim()
	if (!avatarVal) return

	if (isAvatarImageUrl(avatarVal)) {
		const img = document.createElement('img')
		img.src = avatarVal
		img.alt = String(label || '')
		img.style.cssText = 'width:100%;height:100%;object-fit:cover;'
		img.addEventListener('error', () => {
			img.remove()
			letter.hidden = false
		}, { once: true })
		img.addEventListener('load', () => {
			letter.hidden = true
		}, { once: true })
		host.appendChild(img)
		return
	}

	host.textContent = avatarVal
	host.style.fontSize = emojiFontSize
	host.style.background = avatarColor(String(seed || label || '?'))
	host.style.color = avatarTextColor(String(seed || label || '?'))
}
