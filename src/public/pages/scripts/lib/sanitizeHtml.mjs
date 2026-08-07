/**
 * 宽松 HTML 消毒：保留排版标签，剥 script/`on*`/危险 URL；`sanitizePermissiveHtml` 另移除 style。
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
 * 拒绝协议相对 `//…` / `/\…`（否则会被 `\/` 分支误放行）。
 * @param {string | null | undefined} url 原始 URL
 * @returns {boolean} 是否安全
 */
export function isSafeHtmlUrl(url) {
	const raw = String(url ?? '').trim()
	if (!raw || raw.startsWith('//') || raw.startsWith('/\\')) return false
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
 * 收集待消杀节点：Element 根含自身；DocumentFragment 等从子节点起。
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
	if (root.nodeType === 1) walk(/** @type {ChildNode} */ root)
	else for (const child of root.childNodes) walk(child)
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
		const element = /** @type {Element} */ node
		for (const attribute of [...element.attributes]) {
			const lowerName = attribute.name.toLowerCase()
			if (lowerName.startsWith('on')) {
				element.removeAttribute(attribute.name)
				continue
			}
			if (!URL_HTML_ATTRIBUTES.has(lowerName)) continue
			if (lowerName === 'srcset') {
				element.removeAttribute(attribute.name)
				continue
			}
			if (!isSafeHtmlUrl(attribute.value))
				element.removeAttribute(attribute.name)
		}
	}
}

/**
 * 保留标签结构；移除 `on*`、全部 `srcset` 与不安全 URL，保留 `style`。
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
		const element = /** @type {Element} */ node
		const tagName = element.tagName.toLowerCase()
		if (BLOCKED_HTML_TAGS.has(tagName)) {
			element.remove()
			continue
		}
		element.removeAttribute('style')
	}
	scrubActiveAttrsInPlace(root)
}

/**
 * 消毒 HTML 字符串（需要 document / template）。
 * @param {string | null | undefined} html 原文（可含安全标签）
 * @returns {string} 消毒后 HTML
 */
export function sanitizePermissiveHtml(html) {
	const raw = String(html ?? '')
	if (!raw) return ''
	const content = parseHtmlInTemplate(raw)
	sanitizeHtmlTree(content)
	const holder = document.createElement('div')
	holder.appendChild(content)
	return holder.innerHTML
}
