/**
 * 完整 HTML 文档的元数据 / 地标 / a11y 静态检查（原 .esh/commands/verify-meta.py）。
 */
import { parseHTML } from 'npm:linkedom'

/** @type {readonly { tag: string, attrs: Record<string, string | null> }[]} */
export const REQUIRED_TAGS = Object.freeze([
	{ tag: 'meta', attrs: { charset: null } },
	{ tag: 'meta', attrs: { name: 'viewport' } },
	{ tag: 'meta', attrs: { property: 'og:title' } },
	{ tag: 'meta', attrs: { property: 'og:type' } },
	{ tag: 'meta', attrs: { property: 'og:description' } },
	{ tag: 'meta', attrs: { property: 'og:image' } },
	{ tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml' } },
	{ tag: 'title', attrs: {} },
	{ tag: 'meta', attrs: { name: 'description' } },
])

/** ARIA in HTML：aside 允许的显式 role。 */
export const ASIDE_ALLOWED_ROLES = Object.freeze(new Set([
	'complementary',
	'feed',
	'none',
	'note',
	'presentation',
	'region',
	'search',
	'status',
]))

/**
 * 是否为完整 HTML 文档（含 doctype 或 html 根）。
 * @param {string} content 原始内容
 * @returns {boolean} 完整文档则为 true
 */
export function isFullHtmlDocument(content) {
	const normalized = content.replaceAll('\r', '').replaceAll('\n', ' ').toLowerCase()
	return normalized.includes('<!doctype html') || normalized.includes('<html')
}

/**
 * @param {Document} document linkedom document
 * @returns {boolean} 是否有 main 地标
 */
export function hasMainLandmark(document) {
	return !!document.querySelector('main')
}

/**
 * DaisyUI drawer-toggle：应对辅助技术隐藏或提供可访问名称。
 * @param {Document} document linkedom document
 * @returns {string[]} 问题描述
 */
export function checkDrawerToggles(document) {
	/** @type {string[]} */
	const issues = []
	for (const tag of document.querySelectorAll('input.drawer-toggle')) {
		if (tag.getAttribute('aria-hidden') === 'true') continue
		if (tag.hasAttribute('aria-label') || tag.hasAttribute('aria-labelledby') || tag.hasAttribute('data-i18n'))
			continue
		const style = (tag.getAttribute('style') || '').replaceAll(' ', '').toLowerCase()
		if (style.includes('display:none')) continue
		const id = tag.getAttribute('id')
		if (id && [...document.querySelectorAll('label[for]')].some(label => label.getAttribute('for') === id))
			continue
		issues.push(`<input class="drawer-toggle" id="${id || 'drawer-toggle'}">（需 aria-hidden 或可访问名称）`)
	}
	return issues
}

/**
 * aside 上禁止使用 ARIA in HTML 不允许的 role。
 * @param {Document} document linkedom document
 * @returns {string[]} 问题描述
 */
export function checkAsideAriaRoles(document) {
	/** @type {string[]} */
	const issues = []
	for (const tag of document.querySelectorAll('aside')) {
		const role = (tag.getAttribute('role') || '').trim().toLowerCase()
		if (!role || ASIDE_ALLOWED_ROLES.has(role)) continue
		const ident = tag.getAttribute('id')
			|| [...tag.classList || []].join(' ')
			|| 'aside'
		issues.push(`<aside … role="${role}"> (${ident})`)
	}
	return issues
}

/**
 * @param {Element} tag 候选标签
 * @param {Record<string, string | null>} attrs 要求的属性
 * @returns {boolean} 是否匹配
 */
function tagMatchesAttrs(tag, attrs) {
	for (const [key, value] of Object.entries(attrs)) {
		if (!tag.hasAttribute(key)) return false
		if (value != null && tag.getAttribute(key) !== value) return false
	}
	return true
}

/**
 * @param {Document} document linkedom document
 * @returns {string[]} 缺失标签描述
 */
export function checkHtmlMeta(document) {
	const head = document.querySelector('head')
	if (!head) return []

	/** @type {string[]} */
	const missing = []
	for (const { tag, attrs } of REQUIRED_TAGS) {
		let found = false
		if (tag === 'link' && attrs.rel === 'icon' && attrs.type === 'image/svg+xml') 
			for (const link of head.querySelectorAll('link[rel=icon]')) {
				const href = link.getAttribute('href') || ''
				const type = link.getAttribute('type') || ''
				if (href.endsWith('.svg') || type === 'image/svg+xml') {
					found = true
					break
				}
			}
		
		else if (tag === 'title')
			found = !!head.querySelector('title')
		else 
			for (const el of head.querySelectorAll(tag)) 
				if (tagMatchesAttrs(el, attrs)) {
					found = true
					break
				}
			
		
		if (!found) {
			const attrStr = Object.entries(attrs)
				.map(([k, v]) => v == null ? k : `${k}="${v}"`)
				.join(' ')
			missing.push(attrStr ? `<${tag} ${attrStr}>` : `<${tag}>`)
		}
	}
	return missing
}

/**
 * 对一份 HTML 内容跑全套检查。
 * @param {string} content HTML 文本
 * @returns {{ skipped: true } | { skipped: false, missingMeta: string[], missingMain: boolean, badToggles: string[], badAsideRoles: string[] }} 跳过或检查结果
 */
export function inspectHtmlDocument(content) {
	if (!isFullHtmlDocument(content))
		return { skipped: true }
	const { document } = parseHTML(content)
	return {
		skipped: false,
		missingMeta: checkHtmlMeta(document),
		missingMain: !hasMainLandmark(document),
		badToggles: checkDrawerToggles(document),
		badAsideRoles: checkAsideAriaRoles(document),
	}
}

/**
 * @param {{ skipped: true } | { skipped: false, missingMeta: string[], missingMain: boolean, badToggles: string[], badAsideRoles: string[] }} result inspect 结果
 * @returns {boolean} 是否有问题
 */
export function hasHtmlIssues(result) {
	if (result.skipped) return false
	return !!(result.missingMeta.length || result.missingMain || result.badToggles.length || result.badAsideRoles.length)
}
