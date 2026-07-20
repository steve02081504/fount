/**
 * 实体 profile 主题色：显式 themeColor 或 hash 头像派生色。
 */
import { hashAvatarRgb, rgbCss } from './hashAvatar.mjs'

const THEME_RE = /^#[\da-f]{6}$/i

/**
 * @param {unknown} value 原始色值
 * @returns {string} 规范化 `#rrggbb` 或空串
 */
export function normalizeThemeColor(value) {
	const raw = String(value ?? '').trim()
	if (!raw) return ''
	return THEME_RE.test(raw) ? raw.toLowerCase() : ''
}

/**
 * @param {object | null | undefined} profile 资料（含 themeColor）
 * @param {string} [entityHash] 回退 seed
 * @returns {string} CSS 颜色
 */
export function themeColorForEntity(profile, entityHash = '') {
	const explicit = normalizeThemeColor(profile?.themeColor)
	if (explicit) return explicit
	const seed = String(entityHash || profile?.entityHash || '')
	return rgbCss(hashAvatarRgb(seed))
}
