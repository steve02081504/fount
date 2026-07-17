/**
 *
 */
export {
	entityAvatarUrl,
	renderAvatarHtml,
} from '/parts/shells:chat/shared/entityAvatar.mjs'

import { aliasForEntity } from '/parts/shells:chat/shared/aliases.mjs'
import { formatEntityAtId, formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'

import { processFountMessageMarkdown } from '/parts/shells:chat/src/lib/fountMessageMarkdown.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

import { formatSocialPostHref } from '../../shared/runUri.mjs'

/**
 *
 */
export { formatEntityAtId }

/** @type {Map<string, string>} entityHash → 具名 handle（会话内缓存） */
const knownHandles = new Map()

/**
 * 记住实体具名 handle，供帖卡/回复等瘦摘要补全 at-id。
 * @param {string} entityHash entity hash
 * @param {{ handle?: string | null } | string | null | undefined} profileOrHandle 资料或 handle 字符串
 * @returns {void}
 */
export function rememberEntityHandle(entityHash, profileOrHandle) {
	const key = String(entityHash || '').trim().toLowerCase()
	if (!key) return
	const raw = typeof profileOrHandle === 'string'
		? profileOrHandle
		: profileOrHandle?.handle
	const handle = String(raw || '').trim().replace(/^@+/u, '').toLowerCase()
	if (handle) knownHandles.set(key, handle)
}

/**
 * at-id 表述：有具名 handle 时 `@handle (@hash…)`，否则 `@hash…`。
 * 优先 profile.handle，其次会话内缓存（资料页已加载、其它卡片已见过）。
 * @param {string} entityHash entity hash
 * @param {{ handle?: string | null } | null} [profile] 可选资料（取 handle）
 * @returns {string} at-id
 */
export function entityHandle(entityHash, profile = null) {
	const key = String(entityHash || '').trim().toLowerCase()
	const handle = String(profile?.handle || '').trim() || knownHandles.get(key) || ''
	if (handle) rememberEntityHandle(key, handle)
	return formatEntityAtId(entityHash, { handle })
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
 * @param {number} [ts] 毫秒时间戳
 * @returns {string} 相对时间
 */
export function formatTime(ts) {
	const value = Number(ts) || Date.now()
	const delta = Date.now() - value
	if (delta < 60_000) return geti18n('social.time.justNow')
	if (delta < 3_600_000) return geti18n('social.time.minutesAgo', { n: Math.floor(delta / 60_000) })
	if (delta < 86_400_000) return geti18n('social.time.hoursAgo', { n: Math.floor(delta / 3_600_000) })
	return new Date(value).toLocaleString()
}

/**
 * 渲染引用原帖块 HTML。
 * @param {{ entityHash: string, postId: string, text?: string }} quoteRef 引用
 * @returns {string} HTML
 */
export function renderQuoteBlockHtml(quoteRef) {
	if (!quoteRef?.entityHash || !quoteRef?.postId) return ''
	const snippet = quoteRef.text
		? `<p class="quote-snippet">${quoteRef.text.slice(0, 200)}${quoteRef.text.length > 200 ? '…' : ''}</p>`
		: ''
	return `
		<blockquote class="quote-block">
			<a href="${formatSocialPostHref(quoteRef.entityHash, quoteRef.postId)}" class="link-btn quote-link">
				${geti18n('social.quote.viewOriginal')}
			</a>
			${snippet}
		</blockquote>
	`
}

