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
import { isTrustedAuthor } from '/parts/shells:chat/src/trustedAuthors.mjs'
import { createDocumentFragmentFromHtmlStringNoScriptActivation, renderTemplateAsHtmlString } from '/scripts/features/template.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

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
	return isTrustedAuthor(pubKeyHash)
}

/**
 * 将 Markdown 源本机安全渲染为 HTML 字符串（不信任对端预渲染结果；可信作者才允许危险 HTML）。
 * @param {string} markdown 原文
 * @param {string} pubKeyHash 作者
 * @returns {Promise<string>} HTML
 */
export async function renderMarkdown(markdown, pubKeyHash) {
	const trusted = await isTrusted(pubKeyHash)
	return processFountMessageMarkdown(markdown || '', trusted)
}

/**
 * 将 Markdown 源本机安全渲染进 DOM 宿主（勿对源做 escapeHtml）。
 * @param {HTMLElement} host 宿主
 * @param {string} markdown 原文
 * @param {string} pubKeyHash 作者
 * @returns {Promise<void>}
 */
export async function mountMarkdown(host, markdown, pubKeyHash) {
	if (!(host instanceof HTMLElement)) return
	const html = await renderMarkdown(markdown, pubKeyHash)
	host.classList.add('markdown-body')
	host.replaceChildren(createDocumentFragmentFromHtmlStringNoScriptActivation(html))
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
 * @returns {Promise<string>} HTML
 */
export async function renderQuoteBlockHtml(quoteRef) {
	if (!quoteRef?.entityHash || !quoteRef?.postId) return ''
	const snippetHtml = quoteRef.text
		? `<p class="quote-snippet">${escapeHtml(quoteRef.text.slice(0, 200))}${quoteRef.text.length > 200 ? '…' : ''}</p>`
		: ''
	return renderTemplateAsHtmlString('quote_block', {
		href: escapeHtml(formatSocialPostHref(quoteRef.entityHash, quoteRef.postId)),
		snippetHtml,
	})
}

