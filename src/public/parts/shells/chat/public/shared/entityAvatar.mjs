/**
 * 跨壳实体头像 HTML / URL：hash 字母占位 + 仅用户显式头像可叠图。
 * Chat / Social / Cabinet 共用；勿再各写一套 charAt / 虚构 files/profile/avatar。
 * 本模块保持 Deno-pure（无 `/scripts` / `/parts` URL import）。
 */
import {
	avatarInitial,
	customProfileAvatar,
	hashAvatarStyle,
	isAvatarImageUrl,
} from './hashAvatar.mjs'

/**
 * @param {string} text 原文
 * @returns {string} HTML 转义
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * 仅返回用户显式设置的头像 URL；无则空串（前端应画 hash 字母，勿盲请求 EVFS）。
 * @param {string} _entityHash 实体 hash（保留参数便于调用方统一签名）
 * @param {object} [profile] 资料
 * @returns {string} 头像 URL 或空
 */
export function entityAvatarUrl(_entityHash, profile) {
	return customProfileAvatar(profile) || ''
}

/**
 * 渲染实体头像 HTML（图片优先，失败或无图时用 hash 文字头像）。
 * @param {string} entityHash 实体 hash
 * @param {object} [profile] 可选资料（需含 name / avatar / infoDefaults 才可正确区分继承默认）
 * @param {string} [sizeClass=''] 尺寸 class
 * @returns {string} 头像 HTML
 */
export function renderAvatarHtml(entityHash, profile, sizeClass = '') {
	const seed = String(entityHash || '').trim() || '?'
	const label = profile?.name || seed
	const { background, color } = hashAvatarStyle(seed)
	const initial = escapeHtml(avatarInitial(label))
	const cls = `author-avatar hash-avatar ${sizeClass}`.trim()
	const avatar = customProfileAvatar(profile)
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
