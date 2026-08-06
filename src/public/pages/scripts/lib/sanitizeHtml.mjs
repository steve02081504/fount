/**
 * 宽松 HTML 消毒：保留排版标签，剥 script/事件/危险 URL。
 * 供 displayName 等「允许富文本但不允许有毒」场景；与 Markdown 未信任档规则对齐。
 * 字符串入口一律经惰性 `<template>` 解析后再消杀，避免先挂活树再 scrub 的竞态。
 */

/** 宽松消毒时一律剥离的危险 HTML 标签集合。 */
export const BLOCKED_HTML_TAGS = new Set([
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'link',
	'meta',
	'base',
	'form',
	'svg',
	'math',
	'template',
])

/** 未信任档会校验或剥离的 URL 类属性。 */
export const URL_HTML_ATTRIBUTES = new Set([
	'src',
	'href',
	'xlink:href',
	'srcset',
	'poster',
	'formaction',
	'action',
	'cite',
	'background',
	'data',
])

/** 允许写入 DOM 的 URL scheme 白名单正则。 */
export const SAFE_HTML_URL_SCHEMES = /^(https?:|mailto:|tel:|#|\/|about:blank#|fount:)/i

/**
 * href/src 是否允许写入 DOM（与 Markdown 未信任档、mediaRefs 共用）。
 * 拒绝协议相对 `//…`（否则会被 `\/` 分支误放行）。
 * @param {string | null | undefined} url 原始 URL
 * @returns {boolean} 是否安全
 */
export function isSafeHtmlUrl(url) {
	const raw = String(url ?? '').trim()
	if (!raw || raw.startsWith('//')) return false
	return SAFE_HTML_URL_SCHEMES.test(raw)
}

/**
 * 在惰性 `<template>` 中解析 HTML（不加载资源、不执行脚本）。
 * @param {string} html 原文
 * @returns {DocumentFragment} template.content
 */
function parseHtmlInTemplate(html) {
	const template = document.createElement('template')
	template.innerHTML = html
	return template.content
}

/**
 * 收集 root 下全部节点（含后代）。
 * @param {Element | DocumentFragment | ChildNode} root 根
 * @returns {ChildNode[]} 深度优先节点列表
 */
function collectDescendants(root) {
	const nodes = []
	/**
	 * @param {ChildNode} node 当前节点
	 * @returns {void}
	 */
	const walk = (node) => {
		nodes.push(node)
		if (node.nodeType === 1)
			for (const child of [...node.childNodes]) walk(child)
	}
	for (const child of [...root.childNodes]) walk(child)
	return nodes
}

/**
 * 原地剥 `on*` 与危险 URL。
 * @param {Element | DocumentFragment | ChildNode} root 待清洗子树
 * @returns {void}
 */
function scrubActiveAttrsInPlace(root) {
	for (const node of collectDescendants(root)) {
		if (node.nodeType !== 1) continue
		const el = /** @type {Element} */ (node)
		for (const attr of [...el.attributes]) {
			const lowerName = attr.name.toLowerCase()
			if (lowerName.startsWith('on')) {
				el.removeAttribute(attr.name)
				continue
			}
			if (!URL_HTML_ATTRIBUTES.has(lowerName)) continue
			if (lowerName === 'srcset') {
				el.removeAttribute(attr.name)
				continue
			}
			if (!isSafeHtmlUrl(attr.value))
				el.removeAttribute(attr.name)
		}
	}
}

/**
 * 保留标签结构，仅剥 `on*`（含 SVG 事件）与危险 URL。
 * - `string`：经 `<template>` 解析 → 消杀 → 返回 `DocumentFragment`（可直接 `replaceChildren`）
 * - DOM 根：原地消杀并返回同一引用
 * @param {string | Element | DocumentFragment | ChildNode} htmlOrRoot HTML 或待清洗子树
 * @returns {DocumentFragment | Element | DocumentFragment | ChildNode} 消杀后的内容
 */
export function scrubHtmlActivePayload(htmlOrRoot) {
	if (typeof htmlOrRoot === 'string') htmlOrRoot = parseHtmlInTemplate(htmlOrRoot)
	scrubActiveAttrsInPlace(htmlOrRoot)
	return htmlOrRoot
}

/**
 * @param {Element | DocumentFragment | ChildNode} root 待消毒子树
 * @returns {void}
 */
export function sanitizeHtmlTree(root) {
	for (const node of collectDescendants(root)) {
		if (node.nodeType !== 1) continue
		const el = /** @type {Element} */ (node)
		const tagName = el.tagName.toLowerCase()
		if (BLOCKED_HTML_TAGS.has(tagName))
			el.remove()
	}
	scrubActiveAttrsInPlace(root)
}

/**
 * 消毒 HTML 字符串；无 document 时退化为剥尖括号（测试外路径不应发生）。
 * @param {string | null | undefined} html 原文（可含安全标签）
 * @returns {string} 消毒后 HTML
 */
export function sanitizePermissiveHtml(html) {
	const raw = String(html ?? '')
	if (!raw) return ''
	if (typeof document === 'undefined')
		return raw.replace(/[<>&"']/g, ch => ({
			'<': '&lt;',
			'>': '&gt;',
			'&': '&amp;',
			'"': '&quot;',
			'\'': '&#39;',
		})[ch])

	const content = parseHtmlInTemplate(raw)
	sanitizeHtmlTree(content)
	const holder = document.createElement('div')
	holder.appendChild(content)
	return holder.innerHTML
}
