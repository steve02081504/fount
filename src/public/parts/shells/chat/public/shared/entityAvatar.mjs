/**
 * 跨壳实体头像 HTML / URL：hash 字母占位 + profile.avatar 叠图。
 * Chat / Social / Cabinet 共用；勿再各写一套 charAt / 虚构 files/profile/avatar。
 * 本模块保持 Deno-pure（无 `/scripts` / `/parts` URL import）。
 */
import { escapeHtml } from './escapeHtml.mjs'
import {
	avatarInitial,
	displayProfileAvatar,
	hashAvatarStyle,
	isAvatarImageUrl,
} from './hashAvatar.mjs'

/**
 * 返回 profile.avatar；无则空串。
 * @param {string} _entityHash 实体 hash（保留参数便于调用方统一签名）
 * @param {object} [profile] 资料
 * @returns {string} 头像 URL 或空
 */
export function entityAvatarUrl(_entityHash, profile) {
	return displayProfileAvatar(profile) || ''
}

/**
 * 渲染实体头像 HTML（图片优先，失败或无图时用 hash 文字头像）。
 * @param {string} entityHash 实体 hash
 * @param {object} [profile] 可选资料
 * @param {string} [sizeClass=''] 尺寸 class
 * @returns {string} 头像 HTML
 */
export function renderAvatarHtml(entityHash, profile, sizeClass = '') {
	const seed = String(entityHash || '').trim() || '?'
	const label = profile?.name || seed
	const { background, color } = hashAvatarStyle(seed)
	const initial = escapeHtml(avatarInitial(label))
	const cls = `author-avatar hash-avatar ${sizeClass}`.trim()
	const avatar = displayProfileAvatar(profile)
	if (!avatar)
		return `<div class="${cls}" style="background:${background};color:${color}">${initial}</div>`

	if (!isAvatarImageUrl(avatar))
		return `<div class="${cls}" style="background:${background};color:${color};font-size:1.1em">${escapeHtml(avatar)}</div>`

	return `<div class="${cls}" style="background:${background};color:${color}">`
		+ `<span class="hash-avatar-letter">${initial}</span>`
		+ `<img class="hash-avatar-img" src="${escapeHtml(avatar)}" alt="" loading="lazy"`
		+ ' onload="this.classList.add(\'is-loaded\')" onerror="this.remove()" />'
		+ '</div>'
}
