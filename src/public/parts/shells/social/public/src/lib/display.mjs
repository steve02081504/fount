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
import { isTrustedMarkdownAuthor } from '/parts/shells:chat/src/trustedAuthors.mjs'
import { createDocumentFragmentFromHtmlStringNoScriptActivation, renderTemplateAsHtmlString } from '/scripts/features/template.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { formatSocialPostHref } from '../../shared/runUri.mjs'
import { viewerEntityHash } from './apiClient.mjs'

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
 * 判断作者是否应对 Markdown 走可信 pipeline（本人或信任表）。
 * @param {string} pubKeyHash 作者 hash
 * @returns {Promise<boolean>} 是否可信
 */
export async function isTrusted(pubKeyHash) {
	return isTrustedMarkdownAuthor(pubKeyHash, { selfEntityHash: viewerEntityHash() })
}

/**
 * 将 Markdown 源本机安全渲染为 HTML 字符串（不信任对端预渲染结果；可信作者才允许危险 HTML）。
 * 本人帖始终可信，勿再只查信任表。
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
 * 相对时间的 data-i18n 描述（或绝对时间纯文本）。
 * @param {number} [ts] 毫秒时间戳
 * @returns {{ i18n?: string, n?: number, text?: string }} 属性描述
 */
export function formatTimeAttrs(ts) {
	const value = Number(ts) || Date.now()
	const delta = Date.now() - value
	if (delta < 60_000) return { i18n: 'social.time.justNow' }
	if (delta < 3_600_000) return { i18n: 'social.time.minutesAgo', n: Math.floor(delta / 60_000) }
	if (delta < 86_400_000) return { i18n: 'social.time.hoursAgo', n: Math.floor(delta / 3_600_000) }
	return { text: new Date(value).toLocaleString() }
}

/**
 * 相对时间 HTML（`data-i18n` + 参数，或绝对时间文本）。
 * @param {number} [ts] 毫秒时间戳
 * @param {string} [className] class
 * @param {string} [tag='span'] 标签名
 * @param {Record<string, string>} [extraAttrs] 额外属性（如 href）
 * @returns {string} HTML
 */
export function formatTimeHtml(ts, className = 'post-meta', tag = 'span', extraAttrs = {}) {
	const attrs = formatTimeAttrs(ts)
	const extra = Object.entries(extraAttrs)
		.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
		.join('')
	const classAttr = className ? ` class="${escapeHtml(className)}"` : ''
	if (attrs.text)
		return `<${tag}${classAttr}${extra}>${escapeHtml(attrs.text)}</${tag}>`
	const nAttr = attrs.n != null ? ` data-n="${attrs.n}"` : ''
	return `<${tag}${classAttr}${extra} data-i18n="${attrs.i18n}"${nAttr}></${tag}>`
}

/**
 * 无 DOM 场景的相对时间字符串（优先用 formatTimeHtml）。
 * @param {number} [ts] 毫秒时间戳
 * @returns {string} 相对时间
 */
export function formatTime(ts) {
	const attrs = formatTimeAttrs(ts)
	if (attrs.text) return attrs.text
	if (attrs.n != null) return geti18n(attrs.i18n, { n: attrs.n })
	return geti18n(attrs.i18n)
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

