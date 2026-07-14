import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import {
	avatarInitial,
	hashAvatarStyle,
} from '/parts/shells:chat/shared/hashAvatar.mjs'

import { aliasForEntity } from '/parts/shells:chat/shared/aliases.mjs'
import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'

import { processFountMessageMarkdown } from '/parts/shells:chat/src/lib/fountMessageMarkdown.mjs'

import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'

const ENTITY_AVATAR_API = '/api/parts/shells:chat/entities'

/**
 * 格式化为 @handle 展示（hash 缩写）。
 * @param {string} entityHash entity hash
 * @returns {string} @handle
 */
export function entityHandle(entityHash) {
	const hash = String(entityHash || '')
	if (hash.length <= 12) return `@${hash}`
	return formatHashShort(entityHash, { withAt: true, headLen: 8, tailLen: 4 })
}

/**
 * 返回作者展示名（优先 profile，否则 hash 缩写）。
 * @param {string} entityHash 作者 hash
 * @param {object} [profile] 可选资料
 * @returns {string} 展示名
 */
export function authorLabel(entityHash, profile) {
	return aliasForEntity(entityHash) || profile?.name || formatHashShort(entityHash, { headLen: 8, tailLen: 4 })
}

/**
 * 返回 entity 头像 URL（profile 或默认 API）。
 * @param {string} entityHash 实体 hash
 * @param {object} [profile] 可选资料
 * @returns {string} 头像 URL
 */
export function entityAvatarUrl(entityHash, profile) {
	return profile?.avatar || `${ENTITY_AVATAR_API}/${encodeURIComponent(entityHash)}/files/profile/avatar`
}

/**
 * 渲染作者头像 HTML（图片优先，失败或无图时用 hash 文字头像）。
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
	const url = entityAvatarUrl(entityHash, profile)
	if (!profile?.avatar) 
		return `<div class="${cls}" style="background:${background};color:${color}">${initial}</div>`
	
	return `<div class="${cls}" style="background:${background};color:${color}">`
		+ `<span class="hash-avatar-letter">${initial}</span>`
		+ `<img class="hash-avatar-img" src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.remove()" />`
		+ '</div>'
}

/**
 * 判断作者是否在用户可信作者列表中。
 * @param {string} pubKeyHash 作者 hash
 * @returns {Promise<boolean>} 是否为可信作者
 */
export async function isTrusted(pubKeyHash) {
	const response = await fetch('/api/parts/shells:chat/trusted-authors', { credentials: 'include' })
	if (!response.ok) return false
	const data = await response.json()
	return (data.hashes || []).includes((pubKeyHash || '').toLowerCase())
}

/**
 * 将 Markdown 渲染为 HTML（含 Social 链接扩展）。
 * @param {string} markdown 原文
 * @param {string} pubKeyHash 作者
 * @returns {Promise<string>} HTML
 */
export async function renderMarkdown(markdown, pubKeyHash) {
	const trusted = await isTrusted(pubKeyHash)
	return processFountMessageMarkdown(markdown || '', trusted)
}

/**
 * 格式化为相对时间或本地化日期字符串。
 * @param {(key: string, params?: object) => string} geti18n i18n
 * @param {number} [ts] 毫秒时间戳
 * @returns {string} 相对时间
 */
export function formatTime(geti18n, ts) {
	const value = Number(ts) || Date.now()
	const delta = Date.now() - value
	if (delta < 60_000) return geti18n('social.time.justNow')
	if (delta < 3_600_000) return geti18n('social.time.minutesAgo', { n: Math.floor(delta / 60_000) })
	if (delta < 86_400_000) return geti18n('social.time.hoursAgo', { n: Math.floor(delta / 3_600_000) })
	return new Date(value).toLocaleString()
}

/**
 * 渲染引用原帖块 HTML。
 * @param {(key: string, params?: object) => string} geti18n i18n
 * @param {{ entityHash: string, postId: string, text?: string }} quoteRef 引用
 * @returns {string} HTML
 */
export function renderQuoteBlockHtml(geti18n, quoteRef) {
	if (!quoteRef?.entityHash || !quoteRef?.postId) return ''
	const snippet = quoteRef.text
		? `<p class="quote-snippet">${quoteRef.text.slice(0, 200)}${quoteRef.text.length > 200 ? '…' : ''}</p>`
		: ''
	return `
		<blockquote class="quote-block">
			<a href="${formatSocialProfileHref(quoteRef.entityHash, quoteRef.postId)}" class="link-btn quote-link">
				${geti18n('social.quote.viewOriginal')}
			</a>
			${snippet}
		</blockquote>
	`
}
