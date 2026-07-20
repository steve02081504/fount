import { escapeHtml } from '../lib/escapeHtml.mjs'
import { memoizePromise } from '../lib/memo.mjs'

const CSS_ID = 'fount-embed-card-css'
const CSS_HREF = '/scripts/features/embedCard.css'
const TITLE_DISPLAY_MAX = 120
const DESC_DISPLAY_MAX = 200
const ATTR = 'data-fount-embed'

/**
 * 确保 embed 卡片样式已注入。
 * @returns {void}
 */
function ensureEmbedCardCss() {
	if (document.getElementById(CSS_ID)) return
	const link = document.createElement('link')
	link.id = CSS_ID
	link.rel = 'stylesheet'
	link.href = CSS_HREF
	document.head.appendChild(link)
}

/**
 * @param {string} text 原始文本
 * @param {number} maxLen 最大长度
 * @returns {string} 截断后的文本
 */
function truncateText(text, maxLen) {
	const value = String(text || '').trim()
	if (!value) return ''
	if (value.length <= maxLen) return value
	return `${value.slice(0, maxLen - 1)}…`
}

/**
 * @param {string} value 属性值
 * @returns {string} 转义后的属性值
 */
function escapeAttr(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
}

/**
 * @param {Document} doc 解析后的文档
 * @param {{ property?: string, name?: string }} spec meta 选择器
 * @returns {string | undefined} content
 */
function pickMeta(doc, spec) {
	const selectors = []
	if (spec.property) selectors.push(`meta[property="${spec.property}"]`)
	if (spec.name) selectors.push(`meta[name="${spec.name}"]`)
	for (const selector of selectors) {
		const el = doc.querySelector(selector)
		const content = el?.getAttribute('content')?.trim()
		if (content) return content
	}
}

/**
 * @param {string} baseUrl 页面 URL
 * @param {string | undefined} raw 相对或绝对图片 URL
 * @returns {string | undefined} 绝对 URL
 */
function resolveUrl(baseUrl, raw) {
	if (!raw) return undefined
	try {
		return new URL(raw, baseUrl).href
	}
	catch {
		return undefined
	}
}

/**
 * 经 /api/no-cors 抓取页面并解析 Open Graph。
 * @param {string} url 目标 URL
 * @returns {Promise<{ url: string, title?: string, description?: string, image?: string, siteName?: string } | null>} 元数据或 null
 */
async function fetchUnfurl(url) {
	const response = await fetch(`/api/no-cors?url=${encodeURIComponent(url)}`, { credentials: 'include' })
	if (!response.ok) return null
	const contentType = response.headers.get('content-type') || ''
	if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return null
	const html = await response.text()
	const doc = new DOMParser().parseFromString(html, 'text/html')
	const title = pickMeta(doc, { property: 'og:title' })
		|| pickMeta(doc, { name: 'twitter:title' })
		|| doc.querySelector('title')?.textContent?.trim()
		|| undefined
	const description = pickMeta(doc, { property: 'og:description' })
		|| pickMeta(doc, { name: 'twitter:description' })
		|| pickMeta(doc, { name: 'description' })
		|| undefined
	const image = resolveUrl(url,
		pickMeta(doc, { property: 'og:image' })
		|| pickMeta(doc, { name: 'twitter:image' })
		|| pickMeta(doc, { name: 'twitter:image:src' }),
	)
	let siteName = pickMeta(doc, { property: 'og:site_name' })
	if (!siteName)
		try { siteName = new URL(url).hostname } catch { /* ignore */ }
	if (!title && !description && !image) return null
	return {
		url,
		...title ? { title } : {},
		...description ? { description } : {},
		...image ? { image } : {},
		...siteName ? { siteName } : {},
	}
}

/**
 * 会话级 unfurl 缓存。
 */
export const unfurl = memoizePromise(url => url, fetchUnfurl, { max: 128, ttlMs: 1000 * 60 * 30 })

/**
 * @param {{ url?: string, title?: string, description?: string, image?: string, siteName?: string }} embed 卡片数据
 * @returns {string} 单张卡片 HTML
 */
export function renderEmbedCardHtml(embed) {
	if (!embed?.url) return ''
	ensureEmbedCardCss()
	const url = String(embed.url)
	const title = truncateText(embed.title || url, TITLE_DISPLAY_MAX)
	const description = truncateText(embed.description || '', DESC_DISPLAY_MAX)
	const siteName = truncateText(embed.siteName || '', 80)
	const image = String(embed.image || '').trim()
	const imageHtml = image
		? `<img class="fount-embed-card-thumb" src="${escapeAttr(image)}" alt="" loading="lazy" decoding="async" />`
		: ''
	const noImageClass = image ? '' : ' fount-embed-card--no-image'
	const descHtml = description
		? `<div class="fount-embed-card-desc">${escapeHtml(description)}</div>`
		: ''
	const siteHtml = siteName
		? `<div class="fount-embed-card-site">${escapeHtml(siteName)}</div>`
		: ''
	return `\
<article class="fount-embed-card${noImageClass}">
	<a class="fount-embed-card-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
		${imageHtml}
		<div class="fount-embed-card-body">
			${siteHtml}
			<div class="fount-embed-card-title">${escapeHtml(title)}</div>
			${descHtml}
		</div>
	</a>
</article>`
}

/**
 * @param {{ url: string, title?: string, siteName?: string }} embed chip 数据
 * @returns {string} 行内标题胶囊 HTML
 */
export function renderEmbedChipHtml(embed) {
	if (!embed?.url) return ''
	ensureEmbedCardCss()
	const url = String(embed.url)
	let hostname = ''
	try { hostname = new URL(url).hostname } catch { /* ignore */ }
	const title = truncateText(embed.title || hostname || url, TITLE_DISPLAY_MAX)
	const siteName = truncateText(embed.siteName || hostname, 40)
	const favicon = hostname
		? `<img class="fount-embed-chip-favicon" src="${escapeAttr(`https://${hostname}/favicon.ico`)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" />`
		: ''
	const siteHtml = siteName
		? `<span class="fount-embed-chip-site">${escapeHtml(siteName)}</span>`
		: ''
	return `\
<a class="fount-embed-chip" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
	${favicon}${siteHtml}<span class="fount-embed-chip-title">${escapeHtml(title)}</span>
</a>`
}

/**
 * @param {HTMLElement} el 占位链接
 * @returns {Promise<void>}
 */
async function hydrateOne(el) {
	const mode = el.getAttribute(ATTR)
	if (!mode) return
	el.removeAttribute(ATTR)
	const url = el.getAttribute('href') || el.href
	if (!url) return
	let meta
	try {
		meta = await unfurl(url)
	}
	catch {
		return
	}
	if (!meta) return

	if (mode === 'card') {
		const html = renderEmbedCardHtml(meta)
		if (!html) return
		const wrap = document.createElement('div')
		wrap.innerHTML = html
		const card = wrap.firstElementChild
		if (!card) return
		const parent = el.parentElement
		if (parent?.tagName === 'P' && [...parent.childNodes].every(n =>
			n === el || (n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()),
		))
			parent.replaceWith(card)
		else
			el.replaceWith(card)
		return
	}

	if (mode === 'chip') {
		const html = renderEmbedChipHtml(meta)
		if (!html) return
		const wrap = document.createElement('div')
		wrap.innerHTML = html
		const chip = wrap.firstElementChild
		if (chip) el.replaceWith(chip)
	}
}

/**
 * @param {ParentNode | Node} root 扫描根
 * @returns {void}
 */
function hydrateIn(root) {
	/** @type {Element[]} */
	const list = []
	if (root instanceof Element && root.hasAttribute?.(ATTR)) list.push(root)
	if (root.querySelectorAll)
		list.push(...root.querySelectorAll(`[${ATTR}]`))
	for (const el of list)
		if (el instanceof HTMLElement) void hydrateOne(el)
}

let observerStarted = false

/**
 * 启动全局 MutationObserver，自动水合带 data-fount-embed 的裸链接。
 * @returns {void}
 */
export function ensureEmbedHydrator() {
	if (observerStarted || typeof document === 'undefined') return
	observerStarted = true
	ensureEmbedCardCss()
	hydrateIn(document.body)
	new MutationObserver(records => {
		for (const record of records) 
			for (const node of record.addedNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) continue
				hydrateIn(/** @type {ParentNode} */node)
			}
		
	}).observe(document.body, { childList: true, subtree: true })
}
