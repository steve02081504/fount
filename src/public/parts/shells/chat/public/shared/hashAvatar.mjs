/**
 * 默认文字头像：身份 seed 哈希 → RGB 背景，RGB 反色作文字色。Chat / Social 共用。
 */
import { escapeHtml } from './escapeHtml.mjs'

/**
 * @param {string} seed 身份键（entityHash / memberKey / charname 等）
 * @returns {number} 32 位哈希
 */
export function hashAvatarSeed(seed) {
	let hash = 0
	const label = String(seed || '')
	for (let charIndex = 0; charIndex < label.length; charIndex++)
		hash = label.charCodeAt(charIndex) + ((hash << 5) - hash)
	return hash | 0
}

/**
 * @param {string} seed 身份键
 * @returns {{ r: number, g: number, b: number }} 背景 RGB（避免过暗/过亮）
 */
export function hashAvatarRgb(seed) {
	const hash = hashAvatarSeed(seed)
	return {
		r: 64 + (Math.abs(hash) % 192),
		g: 64 + (Math.abs(hash >> 8) % 192),
		b: 64 + (Math.abs(hash >> 16) % 192),
	}
}

/**
 * @param {{ r: number, g: number, b: number }} rgb RGB 分量
 * @returns {string} `rgb(r, g, b)` CSS
 */
export function rgbCss(rgb) {
	return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
}

/**
 * @param {{ r: number, g: number, b: number }} rgb RGB 分量
 * @returns {{ r: number, g: number, b: number }} 反色 RGB
 */
export function invertRgb(rgb) {
	return { r: 255 - rgb.r, g: 255 - rgb.g, b: 255 - rgb.b }
}

/**
 * @param {string} seed 身份键
 * @returns {string} 背景色 CSS
 */
export function avatarColor(seed) {
	return rgbCss(hashAvatarRgb(seed))
}

/**
 * @param {string} seed 身份键
 * @returns {string} 文字色 CSS（背景反色）
 */
export function avatarTextColor(seed) {
	return rgbCss(invertRgb(hashAvatarRgb(seed)))
}

/**
 * @param {string} seed 身份键
 * @returns {{ background: string, color: string }} 内联样式用
 */
export function hashAvatarStyle(seed) {
	const bg = hashAvatarRgb(seed)
	return { background: rgbCss(bg), color: rgbCss(invertRgb(bg)) }
}

/**
 * @param {string} [name] 展示名
 * @returns {string} 单个大写字母
 */
export function avatarInitial(name) {
	return (String(name || '?').trim() || '?').charAt(0).toUpperCase()
}

/**
 * 列表行头像模板字段（friends / sidebar 等）。
 * @param {string} seed 色种子
 * @param {string} label 展示名
 * @param {string} [avatarUrl] 头像 URL
 * @param {string} [imgClass='char-list-avatar-img'] img class
 * @returns {{ avatarBg: string, avatarTextColor: string, avatarInner: string }} 模板字段
 */
export function listAvatarTemplateFields(seed, label, avatarUrl = '', imgClass = 'char-list-avatar-img') {
	const url = String(avatarUrl || '').trim()
	return {
		avatarBg: avatarColor(seed),
		avatarTextColor: avatarTextColor(seed),
		avatarInner: url
			? `<img src="${escapeHtml(url)}" alt="" class="${imgClass}" />`
			: escapeHtml(avatarInitial(label)),
	}
}

/**
 * @param {string} value 头像字段
 * @returns {boolean} 是否为可加载的图片 URL
 */
export function isAvatarImageUrl(value) {
	const raw = String(value || '').trim()
	return raw.startsWith('http') || raw.startsWith('/') || raw.startsWith('data:')
}

/**
 * 资料头像字段（有什么显示什么；空则调用方画 hash 字母）。
 * @param {{ avatar?: string } | null | undefined} profile 资料
 * @returns {string} 头像 URL / emoji；无则为空
 */
export function customProfileAvatar(profile) {
	return String(profile?.avatar || '').trim()
}

/**
 * @param {{ avatar?: string } | null | undefined} profile 资料
 * @returns {string} 同 {@link customProfileAvatar}
 */
export function displayProfileAvatar(profile) {
	return customProfileAvatar(profile)
}

/**
 * 从身份 seed 生成稳定的人物卡纹理参数。
 * @param {string} seed 身份 seed
 * @returns {{ variant: string, angle: number, size: number, offsetX: number, offsetY: number }} 纹理参数
 */
export function entityProfilePattern(seed) {
	const value = hashAvatarSeed(seed) >>> 0
	return {
		variant: ['dots', 'grid', 'diagonal', 'rings', 'stars'][value % 5],
		angle: 18 + ((value >>> 3) % 58),
		size: 28 + ((value >>> 9) % 34),
		offsetX: (value >>> 15) % 31,
		offsetY: (value >>> 21) % 31,
	}
}

/** 连续同作者消息隐藏头像的时间窗（毫秒） */
export const MESSAGE_AVATAR_GROUP_GAP_MS = 30 * 60 * 1000

/**
 * 是否为本作者分组的首条消息（应显示头像与昵称行）。
 * @param {string} authorKey 当前作者键（charId ?? sender）
 * @param {string | null | undefined} prevAuthorKey 上一条作者键
 * @param {number} time 当前消息时间戳（ms）
 * @param {number} prevTime 上一条时间戳（ms）
 * @returns {boolean} 是否显示头像与昵称行
 */
export function isFirstMessageInAuthorGroup(authorKey, prevAuthorKey, time, prevTime) {
	if (!prevAuthorKey) return true
	if (String(authorKey) !== String(prevAuthorKey)) return true
	return (time - prevTime) > MESSAGE_AVATAR_GROUP_GAP_MS
}
